/**
 * The slice of the `chrome` namespace this project touches, declared by hand.
 *
 * `@types/chrome` covers all of it, but pulling the whole package into the
 * modules that only need one storage type is a lot of ambient surface for very
 * little. Declaring the two shapes actually used keeps these modules readable
 * and makes it obvious what the extension depends on.
 */

export interface StorageChange {
  readonly oldValue?: unknown;
  readonly newValue?: unknown;
}
