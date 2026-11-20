import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../utils/image.js', () => ({
  shrinkImageForUpload: vi.fn(async () => 'data:image/jpeg;base64,AAAA'),
}));

import { CustomerPhotoPicker } from './CustomerPhotoPicker.js';
import { shrinkImageForUpload } from '../../utils/image.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const photoFile = () => new File(['x'], 'face.jpg', { type: 'image/jpeg' });

describe('CustomerPhotoPicker', () => {
  it('offers Camera and Choose file; the camera input asks for the camera itself', () => {
    render(<CustomerPhotoPicker value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Camera/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose file/ })).toBeInTheDocument();
    expect(screen.getByTestId('customer-photo-camera')).toHaveAttribute('capture', 'environment');
    expect(screen.getByTestId('customer-photo-file')).not.toHaveAttribute('capture');
  });

  it('shrinks a chosen photo before handing it over', async () => {
    const onChange = vi.fn();
    render(<CustomerPhotoPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('customer-photo-file'), { target: { files: [photoFile()] } });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('data:image/jpeg;base64,AAAA'));
    expect(shrinkImageForUpload).toHaveBeenCalledTimes(1);
  });

  it('shows the photo with Retake and Remove once there is one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CustomerPhotoPicker value="data:image/jpeg;base64,AAAA" onChange={onChange} />);
    expect(screen.getByAltText('Customer photo')).toHaveAttribute('src', 'data:image/jpeg;base64,AAAA');
    expect(screen.getByRole('button', { name: /Retake/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remove/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('says so when a file cannot be used', async () => {
    vi.mocked(shrinkImageForUpload).mockRejectedValueOnce(new Error('Please choose an image.'));
    const onChange = vi.fn();
    render(<CustomerPhotoPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('customer-photo-file'), { target: { files: [photoFile()] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Please choose an image.');
    expect(onChange).not.toHaveBeenCalled();
  });
});
