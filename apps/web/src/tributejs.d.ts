// Minimal ambient types for the TributeJS surface we use.
// If a future tributejs version ships its own types and TS reports a duplicate
// declaration, delete this file.
declare module "tributejs" {
  interface TributeItem<T> {
    original: T;
  }
  interface TributeCollection<T> {
    trigger?: string;
    values:
      | T[]
      | ((text: string, cb: (values: T[]) => void) => void);
    lookup?: string | ((item: T, text: string) => string);
    fillAttr?: string;
    allowSpaces?: boolean;
    selectTemplate?: (item: TributeItem<T> | undefined) => string;
    menuItemTemplate?: (item: TributeItem<T>) => string;
    noMatchTemplate?: () => string;
    containerClass?: string;
    itemClass?: string;
    selectClass?: string;
  }
  export default class Tribute<T> {
    constructor(options: TributeCollection<T>);
    isActive: boolean;
    attach(el: HTMLElement | NodeList | HTMLCollection): void;
    detach(el: HTMLElement | NodeList | HTMLCollection): void;
  }
}
