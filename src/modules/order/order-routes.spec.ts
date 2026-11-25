import { PATH_METADATA } from '@nestjs/common/constants';
import { OrderController } from './order.controller';

/** Route paths in the order they are declared on the class. */
const declaredPaths = (): string[] =>
  Object.getOwnPropertyNames(OrderController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (OrderController.prototype as unknown as Record<string, object>)[name];
      return Reflect.getMetadata(PATH_METADATA, handler) as string;
    })
    .filter((path): path is string => typeof path === 'string');

describe('OrderController route order', () => {
  it('declares the literal delivery-slots route before the :id wildcard', () => {
    // Nest matches in declaration order. Declared after ':id', a GET for
    // /orders/delivery-slots would hit the uuid route and 400 on ParseUUIDPipe — a
    // dead endpoint that every other test would still pass over.
    const paths = declaredPaths();

    expect(paths).toContain('delivery-slots');
    expect(paths.indexOf('delivery-slots')).toBeLessThan(paths.indexOf(':id'));
  });
});
