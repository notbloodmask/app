import {Vircadia, DomainServer} from '@vircadia/web-sdk';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor() {
    this._domainServer = null;
    this._contextID = null;
  }

  setUp() {
    if (this._domainServer !== null) {
      // Is already set up.
      return;
    }

    console.log('Vircadia Web SDK:', Vircadia.version);
    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;

    console.debug('Domain context ID:', this._contextID);
  }

  tearDown() {
    this._domainServer = null;
    this._contextID = null;
  }
}

export const domain = new Domain();
