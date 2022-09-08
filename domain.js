import {Vircadia, DomainServer} from '@vircadia/web-sdk';

// Manages the use of a Vircadia domain for domain multiplayer.
class Domain {
  constructor() {
    this._domainServer = null;
    this._contextID = null;
    this._doTearDown = false;
  }

  setUp() {
    if (this._domainServer !== null) {
      // Is already set up.
      return;
    }

    this._domainServer = new DomainServer();
    this._contextID = this._domainServer.contextID;

    this._doTearDown = true;
  }

  connect(url) {
    console.debug(`Connecting to domain:`, url);
    this._domainServer.connect(url);

    this._doTearDown = false;
  }

  disconnect() {
    console.debug('Disconnecting from domain.');
    this._domainServer.disconnect();

    if (this._doTearDown) {
      this._tearDownInternal();
    }
  }

  tearDown() {
    // Defer tear down until after disconnecting.
    this._doTearDown = true;
  }

  _tearDownInternal() {
    this._domainServer = null;
    this._contextID = null;
    this._doTearDown = false;
  }
}

export const domain = new Domain();
