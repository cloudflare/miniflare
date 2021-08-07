// Suppress experimental warnings
const originalEmitWarning = process.emitWarning;
// @ts-expect-error this works, but overloads are funky in typescript
process.emitWarning = (warning, ctorTypeOptions, ctorCode, ctor) => {
  if (ctorTypeOptions === "ExperimentalWarning") {
    const warningString = warning.toString();
    if (
      warningString.startsWith("VM Modules") ||
      warningString.startsWith("stream/web") ||
      warningString.startsWith("buffer.Blob")
    ) {
      return;
    }
  }
  originalEmitWarning(warning, ctorTypeOptions, ctorCode, ctor);
};
