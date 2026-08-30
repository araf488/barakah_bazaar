import { plainToInstance } from 'class-transformer';
import { TrimString } from './trim.decorator';

class Sample {
  @TrimString()
  value?: unknown;
}

describe('TrimString', () => {
  it('trims a padded string', () => {
    expect(plainToInstance(Sample, { value: '  Rahim Uddin  ' }).value).toBe('Rahim Uddin');
  });

  it('reduces a whitespace-only value to empty, so @IsNotEmpty can reject it', () => {
    expect(plainToInstance(Sample, { value: '   ' }).value).toBe('');
  });

  it('leaves a non-string value alone', () => {
    expect(plainToInstance(Sample, { value: 42 }).value).toBe(42);
  });

  it('leaves an absent value absent, so optional fields stay optional', () => {
    expect(plainToInstance(Sample, {}).value).toBeUndefined();
  });
});
