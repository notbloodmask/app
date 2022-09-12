import {Vircadia, DomainServer} from '@vircadia/web-sdk';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor() {
    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;
    this._url = null;
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

  close() {
    // close() is called before the Vircadia application's useCleanup() so disconnect here.
    if (this._domainServer) {
      this.disconnect();
    }

    this._domainServer = null;
    this._contextID = null;
  }
}

export default Domain;
