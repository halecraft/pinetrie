// lanehost/closed — what a client refuses every call with once its host
// closed it: its channels are gone, and none is opened again.

export class ClientClosed extends Error {
  constructor() {
    super("the host closed its channels to the machine")
    this.name = "ClientClosed"
  }
}
