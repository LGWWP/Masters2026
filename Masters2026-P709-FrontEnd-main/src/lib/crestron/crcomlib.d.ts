// WHY THIS FILE EXISTS
//
// crestron.ts needs the `CrComLib` object, which is the JavaScript "bridge"
// that lets this web app send and receive signals from a Crestron touch
// panel or processor (e.g. publishEvent, subscribeState).
//
// Normally, when you `import` something from an npm package, TypeScript
// already knows its types because the package ships its own .d.ts files.
// That isn't the case here:
//
//   1. The @crestron/ch5-crcomlib package's main entry point only exposes
//      types for its UI components (ch5-button, ch5-slider, etc.), NOT for
//      CrComLib itself.
//   2. To actually get CrComLib at runtime, our code has to reach past the
//      main entry point and import a specific build file directly:
//      '@crestron/ch5-crcomlib/build_bundles/cjs/cr-com-lib.js'
//   3. Because that file path isn't part of the package's documented/typed
//      entry points, TypeScript has no idea what it exports and would
//      normally error with "cannot find module" or treat it as `any`.
//
// WHAT THIS FILE DOES
//
// This file manually tells TypeScript: "when some code imports from that
// exact file path, here is the shape of what it exports." This is called an
// "ambient module declaration" — it doesn't contain any real code, it just
// describes types for JavaScript that already exists elsewhere.
//
// We only describe the handful of CrComLib methods that crestron.ts
// actually uses, including the native panel feedback entry points. CrComLib
// has many more methods in reality, but we don't need TypeScript to know
// about those yet. If future code needs another method, add it here.
declare module '@crestron/ch5-crcomlib/build_bundles/cjs/cr-com-lib.js' {
  export const CrComLib: {
    bridgeReceiveIntegerFromNative(signalName: string, value: number): void;
    bridgeReceiveBooleanFromNative(signalName: string, value: boolean): void;
    bridgeReceiveStringFromNative(signalName: string, value: string): void;
    bridgeReceiveObjectFromNative(signalName: string, value: object): void;

    publishEvent(signalType: 's', signalName: string, value: string): void;

    subscribeState(
      signalType: 'b',
      signalName: string,
      callback: (value: boolean) => void
    ): string;

    subscribeState(
      signalType: 's',
      signalName: string,
      callback: (value: string) => void
    ): string;

    unsubscribeState(signalType: 'b' | 's', signalName: string, subscriptionId: string): void;
  };
}
