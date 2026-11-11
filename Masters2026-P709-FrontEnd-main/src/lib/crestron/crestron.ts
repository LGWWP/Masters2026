import { CrComLib } from '@crestron/ch5-crcomlib/build_bundles/cjs/cr-com-lib.js';

if (typeof window !== 'undefined') {
  // Native panels call these window-level entry points to deliver join feedback.
  Object.assign(window, {
    CrComLib,
    bridgeReceiveIntegerFromNative: CrComLib.bridgeReceiveIntegerFromNative,
    bridgeReceiveBooleanFromNative: CrComLib.bridgeReceiveBooleanFromNative,
    bridgeReceiveStringFromNative: CrComLib.bridgeReceiveStringFromNative,
    bridgeReceiveObjectFromNative: CrComLib.bridgeReceiveObjectFromNative
  });
}

const URL_JOIN = '1';
// Reserved system feedback published by the panel/container to indicate CIP status.
const CIP_CONNECTED_JOIN = 'Csig.All_Control_Systems_Online_fb';

// CrComLib.subscribeState() fires immediately with whatever value is
// CURRENTLY cached for a join the moment you subscribe — before the control
// system has necessarily published anything. An untouched digital join
// defaults to `false`; an untouched serial join defaults to `""`. That first
// delivery can easily be mistaken for a real status change ("CIP
// disconnected", "URL updated to nothing") when it may just be the join's
// resting/default state.
//
// This tracks, per subscription, whether a genuinely truthy value has ever
// been seen. Until one has, a falsy value is reported as "no value yet"
// rather than a confirmed disconnect/empty-update — but once a real value
// HAS been seen, any later falsy value is treated as a real change (e.g. an
// actual CIP drop), not just resting state.
function trackRealValue<T extends boolean | string>(): (value: T) => boolean {
  let haveSeenRealValue = false;
  return (value: T) => {
    const isConfirmedReal = Boolean(value) || haveSeenRealValue;
    if (value) haveSeenRealValue = true;
    return isConfirmedReal;
  };
}

// Subscribe to CIP connection status between the app and the control system(s).
// Returns an unsubscribe function.
export function onCipConnectionChange(callback: (connected: boolean) => void): () => void {
  let subscriptionId: string | undefined;
  const isConfirmedReal = trackRealValue<boolean>();
  try {
    subscriptionId = CrComLib.subscribeState('b', CIP_CONNECTED_JOIN, (value: boolean) => {
      const confirmedReal = isConfirmedReal(value); // always call — updates internal tracking
      if (!value && !confirmedReal) {
        console.warn(
          'CIP: no value received yet (join default/unset) — waiting for the control system.'
        );
      } else {
        const logMethod = value ? console.log : console.warn;
        logMethod(value ? 'CIP connected.' : 'CIP disconnected.');
      }
      callback(value);
    });
  } catch (err) {
    console.error(`Failed to subscribe to CIP status join (${CIP_CONNECTED_JOIN}):`, err);
  }

  return () => {
    if (subscriptionId === undefined) return;
    try {
      CrComLib.unsubscribeState('b', CIP_CONNECTED_JOIN, subscriptionId);
    } catch (err) {
      console.warn(`Failed to unsubscribe from CIP status join (${CIP_CONNECTED_JOIN}):`, err);
    }
  };
}

// console.log(CrComLib.isIosDevice())
// console.log(CrComLib.isCrestronTouchscreen())
// const subId = CrComLib.subscribeState('s', 'Csig.Ip_Address_fb', (ip: string) => {
//     console.log('IP Address:', ip);
// });

// Subscribe to URL changes from the Crestron processor.
// Returns an unsubscribe function.
export function onUrlChange(callback: (url: string) => void): () => void {
  let subscriptionId: string | undefined;
  const isConfirmedReal = trackRealValue<string>();
  try {
    subscriptionId = CrComLib.subscribeState('s', URL_JOIN, (value: string) => {
      const confirmedReal = isConfirmedReal(value); // always call — updates internal tracking
      if (!value && !confirmedReal) {
        console.warn(
          `Processor URL join (${value}): no value received yet (join default/unset) — waiting for the control system.`
        );
      } else {
        console.log(`Processor URL join (${URL_JOIN}) updated:`, value);
      }
      callback(value);
    });
  } catch (err) {
    console.error(`Failed to subscribe to processor URL join (${URL_JOIN}):`, err);
  }

  return () => {
    if (subscriptionId === undefined) return;
    try {
      CrComLib.unsubscribeState('s', URL_JOIN, subscriptionId);
    } catch (err) {
      console.warn(`Failed to unsubscribe from processor URL join (${URL_JOIN}):`, err);
    }
  };
}

export default CrComLib;
