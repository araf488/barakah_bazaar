import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithIntl } from '../../../test/intl';
import { AnnouncementBar } from '../AnnouncementBar';

describe('AnnouncementBar', () => {
  it('announces each message once, though the marquee draws the list twice', () => {
    renderWithIntl(<AnnouncementBar />);
    const region = screen.getByRole('region', { name: 'Announcements' });

    expect(
      within(region)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      'A halal-first marketplace for Bangladesh',
      'Doi and rosmalai travel in cold-chain delivery slots',
      'Dates, nuts and dry fruits, by the pack or by weight',
      'Cash on delivery across our delivery areas',
    ]);
    expect(screen.getAllByText('A halal-first marketplace for Bangladesh')).toHaveLength(2);
  });

  it('speaks Bangla on a Bangla page', () => {
    renderWithIntl(<AnnouncementBar />, 'bn');
    expect(screen.getByRole('region', { name: 'ঘোষণা' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(
      'বাংলাদেশের জন্য একটি হালাল-প্রথম বাজার',
    );
  });

  it('can be paused and resumed, as WCAG 2.2.2 requires of moving content', () => {
    renderWithIntl(<AnnouncementBar />);
    const track = screen.getByTestId('announcement-track');

    fireEvent.click(screen.getByRole('button', { name: 'Pause announcements' }));
    const play = screen.getByRole('button', { name: 'Play announcements' });
    expect(play).toHaveAttribute('aria-pressed', 'true');
    expect(track.className).toContain('[animation-play-state:paused]');

    fireEvent.click(play);
    expect(screen.getByRole('button', { name: 'Pause announcements' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(track.className).not.toMatch(/(^|\s)\[animation-play-state:paused\]/);
  });
});
