import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ImeiScanButton } from './ImeiScanButton.js';
vi.mock('@zxing/browser', () => ({ BrowserMultiFormatOneDReader: class { decode() { return { getText: () => '490154203237518' }; } } }));
afterEach(() => vi.unstubAllGlobals());
describe('IMEI scan in Android WebView', () => {
  it('uses the fallback reader when native BarcodeDetector is unavailable and stops the camera', async () => {
    const stop=vi.fn();const onScan=vi.fn();
    vi.stubGlobal('BarcodeDetector',undefined);
    vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockResolvedValue({getTracks:()=>[{stop}]})}});
    render(<ImeiScanButton onScan={onScan}/>);
    fireEvent.click(screen.getByRole('button',{name:'Scan the IMEI barcode on the box'}));
    await waitFor(()=>expect(onScan).toHaveBeenCalledWith('490154203237518'));
    expect(stop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button',{name:'Close camera'})).not.toBeInTheDocument();
  });
  it('closes a camera permission request safely even when the stream arrives later', async () => {
    let resolve!:(value:unknown)=>void;const stop=vi.fn();const onScan=vi.fn();
    const getUserMedia=vi.fn().mockImplementation(()=>new Promise(r=>{resolve=r}));
    vi.stubGlobal('BarcodeDetector',undefined);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
    render(<ImeiScanButton onScan={onScan}/>);
    fireEvent.click(screen.getByRole('button',{name:'Scan the IMEI barcode on the box'}));
    await waitFor(()=>expect(getUserMedia).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'Close camera'}));
    await act(async()=>{resolve({getTracks:()=>[{stop}]});await Promise.resolve()});
    expect(stop).toHaveBeenCalledOnce();expect(onScan).not.toHaveBeenCalled();
  });
  it('keeps manual entry available when camera access is denied', async () => {
    vi.stubGlobal('BarcodeDetector',undefined);vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn().mockRejectedValue(new Error('Denied'))}});
    render(<ImeiScanButton onScan={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'Scan the IMEI barcode on the box'}));
    expect(await screen.findByText('Could not open the camera. Allow camera access, or type the IMEI.')).toBeInTheDocument();
  });
});
