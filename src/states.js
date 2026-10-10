// -----------------------------------------------------------------------------
// Publish only the states that changed.
//
// The core caps an integration at 300 states per minute and re-evaluates the
// scenes on every state, so an unchanged value is never sent twice. A value is
// remembered once Gladys accepted it; `forget` drops what Gladys may have lost
// (a device just created: the states sent before were dropped by the core).
// -----------------------------------------------------------------------------

const sameValue = (a, b) =>
  typeof a === 'object' && typeof b === 'object' ? a?.text === b?.text : a === b;

export class StatePublisher {
  constructor(gladys) {
    this.gladys = gladys;
    this.last = new Map();
  }

  /**
   * @param {Array<{ id: string, value: number | { text: string } }>} states
   * @returns {Promise<number>} the number of states sent
   */
  async publish(states) {
    const changed = [];
    const seen = new Set();
    for (const { id, value } of states) {
      if (value === null || value === undefined || seen.has(id)) continue;
      seen.add(id);
      if (!this.last.has(id) || !sameValue(this.last.get(id), value)) {
        changed.push({ id, value });
      }
    }
    if (changed.length === 0) return 0;
    await this.gladys.publishStates(
      // A text state travels as `text`, a number as `state` (host API C.3).
      changed.map(({ id, value }) =>
        typeof value === 'object'
          ? { device_feature_external_id: id, text: value.text }
          : { device_feature_external_id: id, state: value },
      ),
    );
    for (const { id, value } of changed) {
      this.last.set(id, value);
    }
    return changed.length;
  }

  /** Remember a value Gladys already holds (it saved a command itself). */
  remember(id, value) {
    this.last.set(id, value);
  }

  /** Forget the values of one device (all its `<device>:<feature>` ids). */
  forget(deviceExternalId) {
    for (const id of this.last.keys()) {
      if (id.startsWith(`${deviceExternalId}:`)) {
        this.last.delete(id);
      }
    }
  }
}
