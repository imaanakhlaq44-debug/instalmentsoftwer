import { EventEmitter } from 'node:events';
const events = new EventEmitter();
events.setMaxListeners(0);
/** A wake-up only. Policy and authorization are always re-read from the database. */
export const deviceCommandSignal = {
  notify(id: string) { events.emit(id); },
  subscribe(id: string, wake: () => void) { events.on(id, wake); return () => { events.off(id, wake); }; },
};
