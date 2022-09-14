import {DomainServer, Camera, AvatarMixer, AudioMixer} from '@vircadia/web-sdk';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor() {
    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;
    this._url = null;

    this._camera = new Camera(this._contextID);
    this._avatarMixer = new AvatarMixer(this._contextID);
    this._audioMixer = new AudioMixer(this._contextID);
    this._audioMixer.audioWorkletRelativePath = './bin/';
    this._audioMixer.positionGetter = () => {
      return this._avatarMixer.myAvatar.position;
    };

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
    this._url = null;
  }

  enableMic(mediaStream) {
    this._audioMixer.audioInput = mediaStream;
    this._audioMixer.inputMuted = false;
  }

  disableMic() {
    this._audioMixer.inputMuted = true;
  }

  update(timestamp) {
    // This method is called each render frame but we don't need to update the domain at that rate.
    if (timestamp - this._lastUpdate >= this._TARGET_GAME_LOOP_INTERVAL) {
      this._camera.update();
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
}

export default Domain;
