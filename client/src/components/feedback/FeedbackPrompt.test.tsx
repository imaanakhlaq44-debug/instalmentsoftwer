import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FeedbackPrompt } from './FeedbackPrompt.js';
import { mockApi, renderPage, fill } from '../../test/harness.js';
import { FEEDBACK_PROMPT_INTERVAL_MS, readLastPromptAt, writeLastPromptAt } from '../../utils/feedbackPrompt.js';

const CONSENT = 'I allow Almas SDM to publish this feedback on its website with the name and city written above. I can withdraw it at any time.';
const none = { testimonial: null, consentText: CONSENT };
const sent = { testimonial: { id: 'tst-1', status: 'PENDING' }, consentText: CONSENT };

// No first delay in tests; re-check often so the "later" path is quick to observe.
const Prompt = () => <FeedbackPrompt firstDelayMs={0} checkEveryMs={20} />;
const dialog = () => screen.queryByRole('dialog');

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('FeedbackPrompt', () => {
  it('asks a shop owner who has not given feedback, and remembers when', async () => {
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /testimonials/mine': none } });
    renderPage(<Prompt />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('How is Almas SDM working for your shop?')).toBeInTheDocument();
    expect(api.to('GET /testimonials/mine')).toHaveLength(1);
    expect(readLastPromptAt('user-1')).not.toBeNull();
    // The shop's name is the default name to show.
    expect(screen.getByLabelText('Name to show')).toHaveValue('Al-Madina Mobile Hub');
  });

  it('never asks once the server says the shop has given feedback', async () => {
    const api = mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /testimonials/mine': sent } });
    renderPage(<Prompt />);
    await waitFor(() => expect(api.to('GET /testimonials/mine')).toHaveLength(1));
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(dialog()).toBeNull();
  });

  it('does not ask again before the interval after "Later"', async () => {
    mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /testimonials/mine': none } });
    renderPage(<Prompt />);
    fireEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(dialog()).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(dialog()).toBeNull();
  });

  it('asks again once the interval has passed', async () => {
    writeLastPromptAt('user-1', Date.now() - FEEDBACK_PROMPT_INTERVAL_MS - 1000);
    mockApi({ role: 'DEALER_ADMIN', routes: { 'GET /testimonials/mine': none } });
    renderPage(<Prompt />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('is never shown to the platform, staff or viewers, and does not even ask the server', async () => {
    for (const role of ['SUPER_ADMIN', 'DEALER_STAFF', 'DEALER_VIEWER'] as const) {
      const api = mockApi({ role, routes: { 'GET /testimonials/mine': none, 'GET /dealers': { dealers: [] } } });
      const { unmount } = renderPage(<Prompt />);
      await act(() => new Promise((r) => setTimeout(r, 60)));
      expect(dialog()).toBeNull();
      expect(api.to('GET /testimonials/mine')).toHaveLength(0);
      unmount();
    }
  });

  it('sends through the feedback API with consent, then stops asking', async () => {
    const api = mockApi({
      role: 'DEALER_ADMIN',
      routes: {
        'GET /testimonials/mine': none,
        'PUT /testimonials/mine': (req: { body: unknown }) => ({ testimonial: { id: 'tst-1', status: 'PENDING', ...(req.body as object) } }),
      },
    });
    renderPage(<Prompt />);
    await screen.findByRole('dialog');

    // Consent is required, as on the Feedback page.
    fireEvent.click(screen.getByRole('radio', { name: '5 out of 5' }));
    fill(screen.getByLabelText('Your feedback'), 'Qistein ab time par aati hain, bohat aasani ho gayi.');
    fill(screen.getByLabelText('City to show'), 'Lahore');
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    expect(await screen.findByText('Tick the box to allow publication, or do not submit.')).toBeInTheDocument();
    expect(api.to('PUT /testimonials/mine')).toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Send for review' }));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(api.to('PUT /testimonials/mine')[0].body).toEqual({
      quote: 'Qistein ab time par aati hain, bohat aasani ho gayi.',
      rating: 5,
      displayName: 'Al-Madina Mobile Hub',
      city: 'Lahore',
      consent: true,
    });

    // Even with the interval long gone, a shop that has sent feedback is not asked again.
    writeLastPromptAt('user-1', 0);
    await act(() => new Promise((r) => setTimeout(r, 80)));
    expect(dialog()).toBeNull();
  });
});
