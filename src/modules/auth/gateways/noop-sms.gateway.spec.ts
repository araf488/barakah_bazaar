import { PinoLogger } from 'nestjs-pino';
import { createMockLogger } from '../../../../test/support/mocks';
import { NoopSmsGateway } from './noop-sms.gateway';

describe('NoopSmsGateway', () => {
  let logger: jest.Mocked<PinoLogger>;
  let gateway: NoopSmsGateway;

  beforeEach(() => {
    logger = createMockLogger();
    gateway = new NoopSmsGateway(logger);
  });

  it('reports success without sending', async () => {
    await expect(gateway.send({ to: '+8801711111111', body: 'Your code is 123456' })).resolves.toBe(
      true,
    );
  });

  it('logs the recipient', async () => {
    await gateway.send({ to: '+8801711111111', body: 'Your code is 123456' });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+8801711111111' }),
      'SMS suppressed: SMS_PROVIDER is noop',
    );
  });

  it('never logs the message body, which may contain an OTP', async () => {
    await gateway.send({ to: '+8801711111111', body: 'Your code is 123456' });

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('123456');
  });
});
