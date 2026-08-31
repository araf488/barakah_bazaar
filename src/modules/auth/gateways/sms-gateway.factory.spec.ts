import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { NoopSmsGateway } from './noop-sms.gateway';
import { createSmsGateway } from './sms-gateway.factory';

describe('createSmsGateway', () => {
  let logger: jest.Mocked<PinoLogger>;

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('binds the noop gateway when SMS_PROVIDER is noop', () => {
    const gateway = createSmsGateway(createMockConfig({ SMS_PROVIDER: 'noop' }), logger);

    expect(gateway).toBeInstanceOf(NoopSmsGateway);
  });

  it('reads SMS_PROVIDER rather than always binding noop', async () => {
    // The variable used to be declared and never read, so setting it did nothing silently.
    const gateway = createSmsGateway(createMockConfig({ SMS_PROVIDER: 'alpha-sms' }), logger);

    expect(gateway).not.toBeInstanceOf(NoopSmsGateway);
    await expect(gateway.send({ to: '+8801711111111', body: 'x' })).resolves.toBe(false);
  });

  it('fails rather than reporting success for a provider with no adapter', async () => {
    // Reporting success would let OTPs vanish while the logs claimed delivery.
    const gateway = createSmsGateway(createMockConfig({ SMS_PROVIDER: 'ssl-wireless' }), logger);

    await expect(gateway.send({ to: '+8801711111111', body: 'x' })).resolves.toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  it('names the provider in the failure log so the misconfiguration is findable', async () => {
    const gateway = createSmsGateway(createMockConfig({ SMS_PROVIDER: 'alpha-sms' }), logger);

    await gateway.send({ to: '+8801711111111', body: 'x' });

    expect(logger.error.mock.calls[0][0]).toMatchObject({ provider: 'alpha-sms' });
  });

  it('never logs the message body', async () => {
    const gateway = createSmsGateway(createMockConfig({ SMS_PROVIDER: 'alpha-sms' }), logger);

    await gateway.send({ to: '+8801711111111', body: 'your code is 123456' });

    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('123456');
  });
});
