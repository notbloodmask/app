import {DomainServer, Camera, AvatarMixer, AudioMixer} from '@vircadia/web-sdk';
import * as Z from 'zjs';

import audioManager from '../audio-manager.js';
import {characterSelectManager} from '../characterselect-manager.js';
import {actionsMapName, appsMapName, playersMapName} from '../constants.js';
import {playersManager} from '../players-manager.js';
import {makeId} from '../util.js';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor(state) {
    this.state = state;

    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;
    this._url = null;

    this._camera = new Camera(this._contextID);

    this._avatarMixer = new AvatarMixer(this._contextID);
    this._myAvatar = this._avatarMixer.myAvatar;
    this._avatarList = this._avatarMixer.avatarList;
    this._avatarList.avatarAdded.connect((id) => {
      this._onAvatarAdded(id);
    });
    this._avatarList.avatarRemoved.connect((id) => {
      this._onAvatarRemoved(id);
    });

    this._audioMixer = new AudioMixer(this._contextID);
    this._audioMixer.audioWorkletRelativePath = './bin/';
    this._audioMixer.positionGetter = () => {
      return this._avatarMixer.myAvatar.position;
    };
    this._audioMixer.orientationGetter = () => {
      return this._avatarMixer.myAvatar.orientation;
    };
    this._audioMixer.onStateChanged = (state) => {
      this._onAudioMixerStateChanged(state);
    }

    this._audioContext = null;
    this._audioOutputSource = null;

    this._avatarIDs = new Map(); // Vircadia user session UUID to Webaverse player ID.
    this._remotePlayersToScriptAvatar = new Map();

    this._TARGET_GAME_LOOP_FPS = 30;
    this._TARGET_GAME_LOOP_INTERVAL = 1000 / this._TARGET_GAME_LOOP_FPS; // ms
    this._lastUpdate = 0;
  }

  hasURL() {
    return this._url !== null;
  }

  connect(url) {
    console.debug('Connecting to domain:', url);
    this._url = url;
    this._domainServer.connect(this._url);
  }

  disconnect() {
    console.debug('Disconnecting from domain.');
    this._domainServer.disconnect();
    this._disconnectAudioOutput();
    this._url = null;
  }

  enableMic(mediaStream) {
    this._audioMixer.audioInput = mediaStream;
  }

  disableMic() {
    this._audioMixer.audioInput = null;
  }

  update(timestamp) {
    // This method is called each render frame but we don't need to update the domain at that rate.
    if (timestamp - this._lastUpdate >= this._TARGET_GAME_LOOP_INTERVAL) {
      const localPlayer = playersManager.getLocalPlayer();

      const playerQuat = localPlayer.quaternion;

      this._camera.position = localPlayer.position;
      this._camera.orientation = {x: playerQuat.x, y: playerQuat.y, z: playerQuat.z, w: playerQuat.w};
      this._camera.update();

      this._myAvatar.position = localPlayer.position;
      this._myAvatar.orientation = {x: playerQuat.x, y: playerQuat.y, z: playerQuat.z, w: playerQuat.w};
      this._avatarMixer.update();

      this._updateRemotePlayers();

      this._lastUpdate = timestamp;
    }
  }

  close() {
    // close() is called before the Vircadia application's useCleanup() so disconnect here.
    if (this._domainServer) {
      this.disconnect();
    }

    this._audioMixer = null;
    this._avatarMixer = null;
    this._camera = null;
    this._domainServer = null;
    this._contextID = null;
  }

  _onAudioMixerStateChanged(state) {
    if (state === AudioMixer.CONNECTED) {
      // Wire up audio output.
      this._connectAudioOutput();
      this._audioMixer.onStateChanged = null;
    }
  }

  _connectAudioOutput() {
    this._audioContext = audioManager.getAudioContext();
    this._audioOutputSource = this._audioContext.createMediaStreamSource(this._audioMixer.audioOutput);
    this._audioOutputSource.connect(this._audioContext.destination);
    this._audioMixer.play();
  }

  _disconnectAudioOutput() {
    this._audioMixer.pause();
    this._audioMixer.audioInput = null;
    this._audioMixer.positionGetter = null;
    if (this._audioOutputSource) {
      this._audioOutputSource.disconnect();
    }
    if (this._audioContext) {
      this._audioContext = null;
    }
  }

  async _onAvatarAdded(uuid) {
    const playerId = makeId(5);
    this._avatarIDs.set(uuid, playerId);
    this._remotePlayersToScriptAvatar.set(playerId, this._avatarList.getAvatar(uuid));

    const defaultPlayerSpec = await characterSelectManager.getDefaultSpecAsync();
    const defaultTransform = new Float32Array([0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);

    const playersArray = this.state.getArray(playersMapName);
    playersArray.doc.transact(() => {
      const playerMap = new Z.Map();
      playerMap.set('playerId', playerId);

      const appId = makeId(5);
      const appsArray = new Z.Array();
      const avatarApp = {
        instanceId: appId,
        contentId: defaultPlayerSpec.avatarUrl,
        transform: defaultTransform,
        components: []
      };
      appsArray.push([avatarApp]);
      playerMap.set(appsMapName, appsArray);

      const actionsArray = new Z.Array();
      // TODO: Add landAction to actionsArray?
      playerMap.set(actionsMapName, actionsArray);

      playerMap.set('avatar', appId);
      // TODO: Add voiceSpec to playerMap?

      playersArray.push([playerMap]);
    });
  }

  _onAvatarRemoved(uuid) {
    const playerId = this._avatarIDs.get(uuid);
    if (playerId) {
      const playersArray = this.state.getArray(playersMapName);
      playersArray.doc.transact(() => {
        for (let i = 0; i < playersArray.length; i++) {
          const playerMap = playersArray.get(i, Z.Map);
          if (playerMap.get('playerId') === playerId) {
            playersArray.delete(i);
            break;
          }
        }
      });
    }
  }

  _updateRemotePlayers() {
    // Update positions of all remote players.
    const remotePlayers = playersManager.getRemotePlayers();
    for (const [playerId, remotePlayer] of remotePlayers) {
      const scriptAvatar = this._remotePlayersToScriptAvatar.get(playerId);
      const position = scriptAvatar.position;
      const orientation = scriptAvatar.orientation;

      // Name label.
      remotePlayer.position.x = position.x;
      remotePlayer.position.y = position.y;
      remotePlayer.position.z = position.z;

      // Avatar.
      remotePlayer.avatarBinding.position.x = position.x;
      remotePlayer.avatarBinding.position.y = position.y;
      remotePlayer.avatarBinding.position.z = position.z;
      remotePlayer.avatarBinding.quaternion.x = orientation.x;
      remotePlayer.avatarBinding.quaternion.y = orientation.y;
      remotePlayer.avatarBinding.quaternion.z = orientation.z;
      remotePlayer.avatarBinding.quaternion.w = orientation.w;
    }
  }
}

export default Domain;
