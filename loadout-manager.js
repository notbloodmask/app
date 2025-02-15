import {playersManager} from './players-manager.js';
import {LoadoutRenderer} from './loadout-renderer.js';
import {InfoboxRenderer} from './infobox.js';
import {createObjectSpriteAnimation} from './object-spriter.js';
import {hotbarSize, infoboxSize} from './constants.js';
import npcManager from './npc-manager.js';

const numSlots = 8;

const appSpritesheetCache = new WeakMap();
const _getAppSpritesheet = app => {
  let spritesheet = appSpritesheetCache.get(app);
  if (!spritesheet) {
    spritesheet = createObjectSpriteAnimation(app);
    appSpritesheetCache.set(app, spritesheet);
  }
  return spritesheet;
};

class LoadoutManager extends EventTarget {
  constructor() {
    super();

    this.appsPerPlayer = new WeakMap();
    this.selectedIndexPerPlayer = new WeakMap();

    this.apps = null;
    this.hotbarRenderers = [];
    this.infoBoxRenderer = null;
    this.selectedIndex = -1;
    this.removeLastWearUpdateFn = null;

    this.ensureRenderers();

    const playerSelectedFn = e => {
      const {oldPlayer, player} = e.data;

      if (oldPlayer) {
        this.unbindPlayer(oldPlayer);
      }
      this.bindPlayer(player);
    };

    playersManager.addEventListener('playerchange', playerSelectedFn);

    const playerRemovedFn = e => {
      const {player} = e.data;
      // delete loadout apps when player is destroyed
      this.appsPerPlayer.delete(player);
      this.selectedIndexPerPlayer.delete(player);
    };
    npcManager.addEventListener('playerremove', playerRemovedFn);

    this.removeListenerFn = () => {
      playersManager.removeEventListener('playerchange', playerSelectedFn);
      npcManager.removeEventListener('playerremove', playerRemovedFn);
    };
  }

  initDefault() {
    // this is the initial event for the first player
    const localPlayer = playersManager.getLocalPlayer();
    this.bindPlayer(localPlayer);
  }

  refresh() {
    for (let i = 0; i < this.hotbarRenderers.length; i++) {
      const app = this.apps[i];
      const hotbarRenderer = this.hotbarRenderers[i];
      const spritesheet = app ? _getAppSpritesheet(app) : null;
      hotbarRenderer.setSpritesheet(spritesheet);
      hotbarRenderer.setSelected(i === this.selectedIndex);
    }

    const index = this.selectedIndex;
    this.dispatchEvent(
      new MessageEvent('selectedchange', {
        data: {
          index,
          app: this.apps[index],
        },
      }),
    );
  }

  bindPlayer(player) {
    this.apps = this.appsPerPlayer.has(player)
      ? this.appsPerPlayer.get(player)
      : Array(numSlots).fill(null);
    this.selectedIndex = this.selectedIndexPerPlayer.has(player)
      ? this.selectedIndexPerPlayer.get(player)
      : -1;

    this.refresh();

    const localPlayer = player;
    const wearupdate = e => {
      const {app, wear, loadoutIndex} = e;

      if (wear) {
        this.apps[loadoutIndex] = app;
        this.setSelectedIndex(loadoutIndex);
      } else {
        for (let i = 0; i < this.apps.length; i++) {
          const a = this.apps[i];
          if (a === app) {
            const hotbarRenderer = this.hotbarRenderers[i];
            hotbarRenderer.setSpritesheet(null);

            this.apps[i] = null;

            const nextIndex = this.getNextUsedIndex();
            this.setSelectedIndex(nextIndex);
            break;
          }
        }
      }
    };
    localPlayer.addEventListener('wearupdate', wearupdate);
    this.removeLastWearUpdateFn = () => {
      localPlayer.removeEventListener('wearupdate', wearupdate);
    };
  }

  unbindPlayer(player) {
    this.appsPerPlayer.set(player, this.apps);
    this.apps = null;

    this.selectedIndexPerPlayer.set(player, this.selectedIndex);
    this.selectedIndex = -1;

    if (this.removeLastWearUpdateFn) {
      this.removeLastWearUpdateFn();
      this.removeLastWearUpdateFn = null;
    }
  }

  ensureRenderers() {
    if (this.hotbarRenderers.length === 0) {
      const size = hotbarSize * window.devicePixelRatio;

      for (let i = 0; i < numSlots; i++) {
        const selected = i === this.selectedIndex;
        const hotbarRenderer = new LoadoutRenderer(size, size, selected);
        this.hotbarRenderers.push(hotbarRenderer);
      }
    }
    if (!this.infoBoxRenderer) {
      this.infoBoxRenderer = new InfoboxRenderer(infoboxSize, infoboxSize);
    }
  }

  getHotbarRenderer(index) {
    return this.hotbarRenderers[index];
  }

  getInfoboxRenderer() {
    return this.infoBoxRenderer;
  }

  getSelectedApp() {
    if (this.selectedIndex !== -1) {
      return this.apps[this.selectedIndex];
    } else {
      return null;
    }
  }

  setSelectedIndex(index) {
    if (index === this.selectedIndex) {
      index = -1;
    }

    if (index === -1 || this.apps[index]) {
      for (let i = 0; i < this.hotbarRenderers.length; i++) {
        this.hotbarRenderers[i].setSelected(i === index);
      }
      this.selectedIndex = index;
    }

    if (this.selectedIndex !== -1) {
      const app = this.apps[this.selectedIndex];
      const spritesheet = _getAppSpritesheet(app);

      const hotbarRenderer = this.hotbarRenderers[this.selectedIndex];
      hotbarRenderer.setSpritesheet(spritesheet);
      this.infoBoxRenderer.setSpritesheet(spritesheet);
    }

    this.dispatchEvent(
      new MessageEvent('selectedchange', {
        data: {
          index,
          app: this.apps[index],
        },
      }),
    );
  }

  /* getNextFreeIndex() {
    this.ensureRenderers();
    for (let i = 0; i < this.hotbarRenderers.length; i++) {
      if (!this.apps[i]) {
        return i;
      }
    }
    return -1;
  } */
  getNextUsedIndex() {
    this.ensureRenderers();
    for (let i = 0; i < this.hotbarRenderers.length; i++) {
      if (this.apps[i]) {
        return i;
      }
    }
    return -1;
  }

  update(timestamp, timeDiff) {
    for (let i = 0; i < this.hotbarRenderers.length; i++) {
      this.hotbarRenderers[i].update(timestamp, timeDiff, i);
    }
    if (this.infoBoxRenderer !== null) {
      this.infoBoxRenderer.update(timestamp, timeDiff);
    }
  }
}
const loadoutManager = new LoadoutManager();

export default loadoutManager;
