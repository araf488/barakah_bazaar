/** Window event any control can fire to open the cart drawer (the header owns it). */
export const OPEN_CART_EVENT = 'bb:open-cart';

export const openCart = (): void => {
  window.dispatchEvent(new Event(OPEN_CART_EVENT));
};
