/* SelfHub — تعریف نوع برای ایمپورت wasm (قانون CompiledWasm در wrangler.jsonc) */
declare module '@mtcute/wasm/mtcute-simd.wasm' {
  const wasmModule: WebAssembly.Module
  export default wasmModule
}
