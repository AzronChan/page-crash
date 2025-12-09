
export interface CustomerEvent<U = any> extends Event {
  detail: U;
}
export const on = function (event: string, fn: (cbEvent: CustomerEvent) => any) {
  if (window.addEventListener) {
    window.addEventListener(
      event,
      function (e) {
        fn.call(this, e as CustomerEvent);
      },
      true
    );
  } else if (window.attachEvent) {
    window.attachEvent(`on${event}`, function (a: any) {
      fn.call(this, a);
    });
  }
};

// 绑定一次事件
export const once = function (event: string, fn: (cbEvent: CustomerEvent) => any) {
  if (window.addEventListener) {
    window.addEventListener(
      event,
      function a(e) {
        fn.call(this, e as CustomerEvent);
        window.removeEventListener(event, a, true);
      },
      true
    );
  } else if (window.attachEvent) {
    window.attachEvent(`on${event}`, function a(e: any) {
      fn.call(this, e);
      window.detachEvent(`on${event}`, a);
    });
  }
};

// 删除事件
export const off = function (event: string, fn: (cbEvent: CustomerEvent) => any) {
  if (!fn) {
    return this;
  }
  if (window.removeEventListener) {
    // @ts-ignore
    window.removeEventListener(event, fn);
  } else if (window.detachEvent) {
    window.detachEvent(event, fn);
  }
  return this;
};
