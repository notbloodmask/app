import {DomainServer, Camera, AvatarMixer, AudioMixer} from '@vircadia/web-sdk';

import audioManager from '../audio-manager.js';
import {playersManager} from '../players-manager.js';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor() {
    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;
    this._url = null;

    this._camera = new Camera(this._contextID);

    this._avatarMixer = new AvatarMixer(this._contextID);
    this._myAvatar = this._avatarMixer.myAvatar;

    this._audioMixer = new AudioMixer(this._contextID);
    this._audioMixer.audioWorkletRelativePath = './bin/';
    this._audioMixer.positionGetter = () => {
      return this._avatarMixer.myAvatar.position;
    };
    this._audioMixer.onStateChanged = (state) => {
      this._onAudioMixerStateChanged(state);
    }

    this._audioContext = null;
    this._audioOutputSource = null;

    this._TARGET_GAME_LOOP_FPS = 20;
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
}

export default Domain;
