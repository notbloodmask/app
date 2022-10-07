/*
npc manager tracks instances of all npcs.
npcs includes,
  - character npcs in party system
  - world npcs
  - detached npcs for player select view
*/

import * as THREE from 'three';
import Avatar from './avatars/avatars.js';
import {LocalPlayer} from './character-controller.js';
import {playersManager} from './players-manager.js';
import * as voices from './voices.js';
import {world} from './world.js';
import {chatManager} from './chat-manager.js';
import {makeId, createRelativeUrl} from './util.js';
import {triggerEmote} from './src/components/general/character/Poses.jsx';
import validEmotionMapping from './validEmotionMapping.json';
import metaversefile from './metaversefile-api.js';
import {runSpeed, walkSpeed} from './constants.js';
import {characterSelectManager} from './characterselect-manager.js';
import { NpcLoadoutManager } from './loadout-manager.js';
import { getAnimationDuration } from './constants.js';

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();

const updatePhysicsFnMap = new WeakMap();
const updateAvatarsFnMap = new WeakMap();
const cancelFnMap = new WeakMap();

class NpcManager extends EventTarget {
  constructor() {
    super();

    this.npcs = [];
    this.npcAppMap = new WeakMap();
    this.detachedNpcs = [];
    this.targetMap = new WeakMap();
  }

  getAppByNpc(npc) {
    return this.npcAppMap.get(npc);
  }

  getNpcByApp(app) {
    return this.npcs.find(npc => this.getAppByNpc(npc) === app);
  }

  async initDefaultPlayer() {
    const defaultPlayerSpec =
      await characterSelectManager.getDefaultSpecAsync();
    const localPlayer = metaversefile.useLocalPlayer();
    // console.log('set player spec', defaultPlayerSpec);
    await localPlayer.setPlayerSpec(defaultPlayerSpec);

    const createPlayerApp = () => {
      const app = metaversefile.createApp();
      app.instanceId = makeId(5);
      app.name = 'player';
      app.contentId = defaultPlayerSpec.avatarUrl;
      return app;
    };
    const app = createPlayerApp();

    const addDefaultPlayer = () => {
      this.addPlayerApp(app, localPlayer, defaultPlayerSpec);

      this.dispatchEvent(
        new MessageEvent('defaultplayeradd', {
          data: {
            player: localPlayer,
          },
        }),
      );

      app.addEventListener('destroy', () => {
        this.removeNpcApp(app);
      });
    };
    addDefaultPlayer();
  }

  async createNpcAsync({
    name,
    avatarUrl,
    position,
    quaternion,
    scale,
    detached,
  }) {
    const npcPlayer = new LocalPlayer({
      npc: true,
      detached,
    });
    npcPlayer.name = name;

    let matrixNeedsUpdate = false;
    if (position) {
      npcPlayer.position.copy(position);
      matrixNeedsUpdate = true;
    }
    if (quaternion) {
      npcPlayer.quaternion.copy(quaternion);
      matrixNeedsUpdate = true;
    }
    if (scale) {
      npcPlayer.scale.copy(scale);
      matrixNeedsUpdate = true;
    }
    if (matrixNeedsUpdate) {
      npcPlayer.updateMatrixWorld();
    }

    npcPlayer.loadoutmanager = new NpcLoadoutManager(npcPlayer);

    await npcPlayer.setAvatarUrl(avatarUrl);
    npcPlayer.updateAvatar(0, 0);

    return npcPlayer;
  }

  destroyNpc(npcPlayer) {
    npcPlayer.destroy();

    this.dispatchEvent(
      new MessageEvent('playerremove', {
        data: {
          player: npcPlayer,
        },
      }),
    );

    const removeIndex = this.npcs.indexOf(npcPlayer);
    if (removeIndex !== -1) {
      this.npcs.splice(removeIndex, 1);
      this.npcAppMap.delete(npcPlayer);
    }
  }

  setPartyTarget(player, target) {
    this.targetMap.set(player, target);
  }

  getPartyTarget(player) {
    return this.targetMap.get(player);
  }

  updatePhysics(timestamp, timeDiff) {
    for (const npc of this.npcs) {
      const updatePhysicsFn = updatePhysicsFnMap.get(this.getAppByNpc(npc));
      if (updatePhysicsFn) {
        updatePhysicsFn(timestamp, timeDiff);
      }
    }
    for (const npc of this.detachedNpcs) {
      const updatePhysicsFn = updatePhysicsFnMap.get(this.getAppByNpc(npc));
      if (updatePhysicsFn) {
        updatePhysicsFn(timestamp, timeDiff);
      }
    }
  }

  updateAvatar(timestamp, timeDiff) {
    for (const npc of this.npcs) {
      const updateAvatarsFn = updateAvatarsFnMap.get(this.getAppByNpc(npc));
      if (updateAvatarsFn) {
        updateAvatarsFn(timestamp, timeDiff);
      }
    }
    for (const npc of this.detachedNpcs) {
      const updateAvatarsFn = updateAvatarsFnMap.get(this.getAppByNpc(npc));
      if (updateAvatarsFn) {
        updateAvatarsFn(timestamp, timeDiff);
      }
    }
  }

  async addPlayerApp(app, npcPlayer, json) {
    this.npcAppMap.set(npcPlayer, app);

    this.dispatchEvent(
      new MessageEvent('playeradd', {
        data: {
          player: npcPlayer,
        },
      }),
    );

    let live = true;
    let character = null;
    const cancelFns = [
      () => {
        live = false;

        if (npcPlayer) {
          this.destroyNpc(npcPlayer);
        }
        if (character) {
          world.loreAIScene.removeCharacter(character);
        }
      },
    ];
    cancelFnMap.set(app, () => {
      for (const cancelFn of cancelFns) {
        cancelFn();
      }
    });

    const mode = app.getComponent('mode') ?? 'attached';

    const animations = Avatar.getAnimations();
    const hurtAnimation = animations.find(a => a.isHurt);
    const hurtAnimationDuration = hurtAnimation.duration;

    app.setPhysicsObject(npcPlayer.characterPhysics.characterController);
    app.getLoreSpec = () => {
      return {
        name: json.name,
        description: json.bio,
      };
    };

    // events
    let targetSpec = null;
    if (mode === 'attached') {
      const _listenEvents = () => {
        const hittrackeradd = e => {
          app.hitTracker.addEventListener('hit', e => {
            if (!npcPlayer.hasAction('hurt')) {
              const newAction = {
                type: 'hurt',
                animation: 'pain_back',
              };
              npcPlayer.addAction(newAction);

              setTimeout(() => {
                npcPlayer.removeAction('hurt');
              }, hurtAnimationDuration * 1000);
            }
          });
        };
        app.addEventListener('hittrackeradded', hittrackeradd);

        const activate = () => {
          if (npcPlayer.getControlMode() === 'npc') {
            this.dispatchEvent(
              new MessageEvent('playerinvited', {
                data: {
                  player: npcPlayer,
                },
              }),
            );
          } else {
            npcPlayer.dispatchEvent({
              type: 'activate',
            });
          }
        };
        app.addEventListener('activate', activate);

        const followTarget = (player, target, timeDiff) => {
          if (target) {
            const v = localVector
              .setFromMatrixPosition(target.matrixWorld)
              .sub(player.position);
            v.y = 0;
            const distance = v.length();

            const speed = THREE.MathUtils.clamp(
              THREE.MathUtils.mapLinear(distance, 2, 3.5, walkSpeed, runSpeed),
              0,
              runSpeed,
            );
            const velocity = v.normalize().multiplyScalar(speed);
            player.characterPhysics.applyWasd(velocity, timeDiff);

            return distance;
          }
          return 0;
        };
        const updatePhysicsFn = (timestamp, timeDiff) => {
          if (npcPlayer) {
            if (npcPlayer.getControlMode() !== 'controlled') {
              if (npcPlayer.getControlMode() === 'party') {
                // if party, follow in a line
                const target = this.getPartyTarget(npcPlayer);
                followTarget(npcPlayer, target, timeDiff);
              } else if (npcPlayer.getControlMode() === 'npc') {
                if (targetSpec) {
                  // if npc, look to targetSpec
                  const target = targetSpec.object;
                  const distance = followTarget(npcPlayer, target, timeDiff);

                  if (target) {
                    if (targetSpec.type === 'moveto' && distance < 2) {
                      targetSpec = null;
                    }
                  }
                }
              }
              const localPlayer = playersManager.getLocalPlayer();
              npcPlayer.setTarget(localPlayer.position);
            }

            npcPlayer.updatePhysics(timestamp, timeDiff);
          }
        };
        const updateAvatarFn = (timestamp, timeDiff) => {
          npcPlayer.updateAvatar(timestamp, timeDiff);
        };

        updatePhysicsFnMap.set(app, updatePhysicsFn);
        updateAvatarsFnMap.set(app, updateAvatarFn);

        cancelFns.push(() => {
          app.removeEventListener('hittrackeradded', hittrackeradd);
          app.removeEventListener('activate', activate);
          updatePhysicsFnMap.delete(app);
          updateAvatarsFnMap.delete(app);
        });
      };
      _listenEvents();
    }

    // load
    if (mode === 'attached') {
      const npcName = json.name;
      const npcVoiceName = json.voice;
      const npcBio = json.bio;
      const npcDetached = !!json.detached;
      let npcWear = json.wear ?? [];
      if (!Array.isArray(npcWear)) {
        npcWear = [npcWear];
      }

      // ai scene
      const _addToAiScene = () => {
        character = world.loreAIScene.addCharacter({
          name: npcName,
          bio: npcBio,
        });
        character.addEventListener('say', e => {
          const localPlayer = playersManager.getLocalPlayer();

          const {message, emote, action, object, target} = e.data;
          const chatId = makeId(5);

          const m = {
            type: 'chat',
            chatId,
            playerId: localPlayer.playerId,
            playerName: localPlayer.name,
            message,
          };

          chatManager.addPlayerMessage(npcPlayer, m);
          if (emote !== 'none' && validEmotionMapping[emote] !== undefined) {
            triggerEmote(validEmotionMapping[emote], npcPlayer);
          }
          if (
            emote === 'supersaiyan' ||
            action === 'supersaiyan' ||
            /supersaiyan/i.test(object) ||
            /supersaiyan/i.test(target)
          ) {
            const newSssAction = {
              type: 'sss',
            };
            npcPlayer.addAction(newSssAction);
          } else if (
            action === 'follow' ||
            (object === 'none' && target === localPlayer.name)
          ) {
            // follow player
            targetSpec = {
              type: 'follow',
              object: localPlayer,
            };
          } else if (action === 'stop') {
            // stop
            targetSpec = null;
          } else if (
            action === 'moveto' ||
            (object !== 'none' && target === 'none')
          ) {
            // move to object
            console.log('move to object', object);
          } else if (
            action === 'moveto' ||
            (object === 'none' && target !== 'none')
          ) {
            // move to player
            targetSpec = {
              type: 'moveto',
              object: localPlayer,
            };
          } else if (['pickup', 'grab', 'take', 'get'].includes(action)) {
            // pick up object
            console.log('pickup', action, object, target);
          } else if (['use', 'activate'].includes(action)) {
            // use object
            console.log('use', action, object, target);
          }
        });
      };
      _addToAiScene();

      const newNpcPlayer = npcPlayer;

      if (!npcDetached) {
        this.npcs.push(npcPlayer);
      } else {
        this.detachedNpcs.push(npcPlayer);
      }

      // attach to scene
      const _addPlayerAvatarToApp = () => {
        app.position.set(0, 0, 0);
        app.quaternion.identity();
        app.scale.set(1, 1, 1);

        // app.add(vrmApp);
        app.updateMatrixWorld();
      };
      _addPlayerAvatarToApp();

      // voice endpoint setup
      const _setVoiceEndpoint = () => {
        const voice = voices.voiceEndpoints.find(
          v =>
            v.name.toLowerCase().replaceAll(' ', '') ===
            npcVoiceName.toLowerCase().replaceAll(' ', ''),
        );
        if (voice) {
          newNpcPlayer.setVoiceEndpoint(voice.drive_id);
        } else {
          console.error(
            '*** unknown voice name',
            npcVoiceName,
            voices.voiceEndpoints,
          );
        }
      };
      _setVoiceEndpoint();
      // wearables
      const _updateWearables = async () => {
        const wearablePromises = npcWear.map(wear =>
          (async () => {
            const {start_url, components} = wear;
            const app = await newNpcPlayer.appManager.addTrackedApp(
              start_url,
              undefined,
              undefined,
              undefined,
              components,
            );
            /* const app = await metaversefile.createAppAsync({
            start_url,
          }); */
            // if (!live) return;

            newNpcPlayer.wear(app);
          })(),
        );
        await wearablePromises;
      };
      await _updateWearables();
    }
  }

  async addNpcApp(app, srcUrl) {
    let json = null;

    const mode = app.getComponent('mode') ?? 'attached';

    // load
    if (mode === 'attached') {
      //--
      const _listenEvents = () => {
        app.addEventListener('hit', e => {
          if (!npcPlayer.hasAction('hurt')) {
            const newAction = {
              type: 'hurt',
              animation: 'pain_back',
            };
            // console.log('add hurtAction', 'npc-manager.js')
            npcPlayer.addAction(newAction);
            // console.log('remove use', 'npc-manager.js')
            npcPlayer.removeAction('use'); // todo: setControlAction() ?

            setTimeout(() => {
              npcPlayer.removeAction('hurt');
            }, 500);
          }
        })

        const activate = () => {
          if (targetSpec?.object !== localPlayer) {
            targetSpec = {
              type: 'follow',
              object: localPlayer,
            };
          } else {
            targetSpec = null;
          }
        };
        app.addEventListener('activate', activate);

        let lastSwordActionTime = 0;
        let lastUseIndex = 0;

        const _getNextUseIndex = animationCombo => {
          if (Array.isArray(animationCombo)) {
            return (lastUseIndex++) % animationCombo.length;
          } else {
            return 0;
          }
        }

        const addSwordAction = (timestamp) => {
          const wearApp = npcPlayer.loadoutmanager.getSelectedApp();
          if(wearApp) {
            const useComponent = wearApp.getComponent('use');
            if (useComponent) {
              const useAction = npcPlayer.getAction('use');
              if (!useAction) {
                const {instanceId} = wearApp;
                const {boneAttachment, animation, animationCombo, animationEnvelope, ik, behavior, position, quaternion, scale} = useComponent;
                const index = _getNextUseIndex(animationCombo);
                const newUseAction = {
                  type: 'use',
                  instanceId,
                  animation,
                  animationCombo,
                  animationEnvelope,
                  ik,
                  behavior,
                  boneAttachment,
                  index,
                  position,
                  quaternion,
                  scale,
                };
                npcPlayer.addAction(newUseAction);
                wearApp.use();
                lastSwordActionTime = timestamp;
              }
            }
          }
        };
        const removeSwordAction = () => {
          const useAction = npcPlayer.getAction('use');
          if(useAction) {
            const app = npcPlayer.loadoutmanager.getSelectedApp();
            app.dispatchEvent({
              type: 'use',
              use: false,
            });
            npcPlayer.removeAction('use');
          }
        };

        const slowdownFactor = 0.4;
        const walkSpeed = 0.075 * slowdownFactor;
        const runSpeed = walkSpeed * 8;
        const speedDistanceRate = 0.07;
        const attackDistance = 1.5;
        const swordActionDuration = 500;

        const frame = e => {
          if (npcPlayer) {
            const {timestamp, timeDiff} = e.data;

            if (targetSpec) {
              const target = targetSpec.object;
              const v = localVector.setFromMatrixPosition(target.matrixWorld)
                .sub(npcPlayer.position);
              v.y = 0;
              const distance = v.length();
              // console.log(distance);
              if (targetSpec.type === 'moveto' && distance < 2) {
                targetSpec = null;
              } else {
                const hurtAction = npcPlayer.getAction('hurt');
                const useAction = npcPlayer.getAction('use');
                if (!hurtAction) {
                  if(distance <= attackDistance) {
                      addSwordAction(timestamp);
                  } else if(!useAction) {
                    const speed = Math.min(Math.max(walkSpeed + ((distance - 0.5) * speedDistanceRate), 0), runSpeed);
                    v.normalize()
                      .multiplyScalar(speed * timeDiff);
                    npcPlayer.characterPhysics.applyWasd(v);
                  }
                }
                if(useAction?.animationCombo?.length > 0
                  && timestamp > lastSwordActionTime + swordActionDuration) {
                  removeSwordAction();
                } else if(useAction?.animation
                  && timestamp > lastSwordActionTime + getAnimationDuration(useAction.animation) * 1000) {
                  removeSwordAction();
                }
              }
            }

            npcPlayer.eyeballTarget.copy(localPlayer.position);
            npcPlayer.eyeballTargetEnabled = true;

            /* if (isNaN(npcPlayer.position.x)) {
              debugger;
            } */
            npcPlayer.updatePhysics(timestamp, timeDiff);
            /* if (isNaN(npcPlayer.position.x)) {
              debugger;
            } */
            npcPlayer.updateAvatar(timestamp, timeDiff);
            /* if (isNaN(npcPlayer.position.x)) {
              debugger;
            } */
          }
        };
        world.appManager.addEventListener('frame', frame);

        cancelFns.push(() => {
          // app.removeEventListener('hittrackeradded', hittrackeradd); // listener and handler added nowhere
          app.removeEventListener('activate', activate);
          world.appManager.removeEventListener('frame', frame);
        });
      };
      _listenEvents();
      //--
      // load json
      const res = await fetch(srcUrl);
      json = await res.json();
      // if (!live) return;

      const npcName = json.name;

      // npc pameters
      let avatarUrl = json.avatarUrl;
      avatarUrl = createRelativeUrl(avatarUrl, srcUrl);

      const npcDetached = !!json.detached;

      const position = localVector
        .setFromMatrixPosition(app.matrixWorld)
        .add(localVector2.set(0, 1, 0));

      // create npc
      const newNpcPlayer = await this.createNpcAsync({
        name: npcName,
        avatarUrl,
        position,
        quaternion: app.quaternion,
        scale: app.scale,
        detached: npcDetached,
      });

      this.addPlayerApp(app, newNpcPlayer, json);
    }
  }

  removeNpcApp(app) {
    const cancelFn = cancelFnMap.get(app);
    if (cancelFn) {
      cancelFnMap.delete(app);
      cancelFn();
    }
  }
}
const npcManager = new NpcManager();
export default npcManager;
