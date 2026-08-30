import { GoogleMapsLink } from './google-maps-link';

describe('GoogleMapsLink', () => {
  describe('parse', () => {
    it.each([
      ['bare coordinates', '23.7925, 90.4078'],
      ['bare coordinates without a space', '23.7925,90.4078'],
      ['a camera URL', 'https://www.google.com/maps/@23.7925,90.4078,17z'],
      ['a q= link', 'https://maps.google.com/?q=23.7925,90.4078'],
      ['an ll= link', 'https://maps.google.com/maps?ll=23.7925,90.4078&z=16'],
      [
        'a place URL',
        'https://www.google.com/maps/place/Gulshan+2/@23.7925,90.4078,17z/data=!4m2!3m1',
      ],
    ])('reads %s', (_label, input) => {
      const parsed = GoogleMapsLink.parse(input);

      expect(parsed?.latitude).toBeCloseTo(23.7925, 3);
      expect(parsed?.longitude).toBeCloseTo(90.4078, 3);
    });

    it('prefers the place pin over the camera position when both are present', () => {
      // `@` is where the camera sat; `!3d!4d` is the pin the customer actually chose.
      const parsed = GoogleMapsLink.parse(
        'https://www.google.com/maps/place/X/@23.8000,90.4000,17z/data=!3m1!4b1!4m2!3d23.7925!4d90.4078',
      );

      expect(parsed?.latitude).toBeCloseTo(23.7925, 3);
      expect(parsed?.longitude).toBeCloseTo(90.4078, 3);
    });

    it('handles a URL-encoded comma', () => {
      const parsed = GoogleMapsLink.parse('https://maps.google.com/?q=23.7925%2C90.4078');

      expect(parsed?.longitude).toBeCloseTo(90.4078, 3);
    });

    it('rejects a pin outside Bangladesh rather than storing a mis-paste', () => {
      // Paris. A real coordinate pair, but not somewhere we deliver.
      expect(GoogleMapsLink.parse('https://www.google.com/maps/@48.8566,2.3522,17z')).toBeNull();
    });

    it.each([
      ['empty', ''],
      ['prose', 'my house near the big mosque'],
      ['a link with no coordinates', 'https://maps.app.goo.gl/abcdef'],
      ['a partial pair', '23.7925,'],
    ])('returns null for %s', (_label, input) => {
      expect(GoogleMapsLink.parse(input)).toBeNull();
    });
  });

  describe('isFollowableUrl', () => {
    it.each([
      'https://maps.app.goo.gl/abc123',
      'https://goo.gl/maps/abc123',
      'https://www.google.com/maps/place/X',
      'https://maps.google.com.bd/?q=1,2',
    ])('accepts %s', (url) => {
      expect(GoogleMapsLink.isFollowableUrl(url)).toBe(true);
    });

    it.each([
      ['a non-Google host', 'https://evil.example.com/redirect'],
      ['a Google lookalike', 'https://google.com.evil.example.com/maps'],
      ['internal metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['localhost', 'http://localhost:3000/admin'],
      ['a file URL', 'file:///etc/passwd'],
      ['not a URL at all', '23.79, 90.40'],
    ])('refuses %s — SSRF guard', (_label, url) => {
      expect(GoogleMapsLink.isFollowableUrl(url)).toBe(false);
    });
  });

  describe('isShortLink', () => {
    it('recognises the share-sheet forms that must be resolved first', () => {
      expect(GoogleMapsLink.isShortLink('https://maps.app.goo.gl/abc')).toBe(true);
      expect(GoogleMapsLink.isShortLink('https://goo.gl/maps/abc')).toBe(true);
    });

    it('does not treat a full URL as short', () => {
      expect(GoogleMapsLink.isShortLink('https://www.google.com/maps/@23.79,90.40,17z')).toBe(
        false,
      );
    });
  });
});
