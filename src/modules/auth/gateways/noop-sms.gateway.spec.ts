import { PinoLogger } from 'nestjs-pino';
import { createMockConfig, createMockLogger } from '../../../../test/support/mocks';
import { NoopSmsGateway } from './noop-sms.gateway';

const message = { to: '+8801711111111', body: 'Your code is 123456' };

describe('NoopSmsGateway', () => {
  let logger: jest.Mocked<PinoLogger>;

  const build = (nodeEnv: string): NoopSmsGateway =>
    new NoopSmsGateway(createMockConfig({ NODE_ENV: nodeEnv }), logger);

  beforeEach(() => {
    logger = createMockLogger();
  });

  it('reports success without sending', async () => {
    await expect(build('test').send(message)).resolves.toBe(true);
  });

  it('logs only the last 3 digits of the recipient outside development', async () => {
    await build('test').send(message);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: '111' }),
      'SMS suppressed: SMS_PROVIDER is noop',
    );
  });

  it.each(['production', 'staging', 'test'])(
    'never logs the full number when NODE_ENV is %s',
    async (nodeEnv) => {
      await build(nodeEnv).send(message);

      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('+8801711111111');
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('+8801711111111');
    },
  );

  it.each(['production', 'staging', 'test'])(
    'never logs the message body when NODE_ENV is %s',
    async (nodeEnv) => {
      await build(nodeEnv).send(message);

      expect(JSON.stringify(logger.info.mock.calls)).not.toContain('123456');
      expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('123456');
    },
  );

  it('logs only the body length outside development', async () => {
    await build('production').send(message);

    expect(logger.info).toHaveBeenCalledWith(
      { to: '111', bodyLength: 19 },
      'SMS suppressed: SMS_PROVIDER is noop',
    );
  });

  it('logs the full body at debug in development, so a developer can read the code', async () => {
    await build('development').send(message);

    expect(logger.debug).toHaveBeenCalledWith(
      { to: '+8801711111111', body: 'Your code is 123456' },
      'SMS suppressed: SMS_PROVIDER is noop',
    );
  });
});
