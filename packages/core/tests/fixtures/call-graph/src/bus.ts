import { EventEmitter } from 'node:events';

export class MessageBus extends EventEmitter {
  send(topic: string, payload: unknown): void {
    this.emit(topic, payload);
  }
}
