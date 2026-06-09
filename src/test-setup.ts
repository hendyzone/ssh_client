import "@testing-library/jest-dom";

// jsdom 不实现 ResizeObserver；提供最小 mock 供组件测试。
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-ignore 注入到 jsdom 全局（lib.dom.d.ts 无此属性时静默）
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
