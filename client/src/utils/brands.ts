/**
 * Phone brands offered in the sale form and the Devices filter. The handset is
 * identified by its IMEI, so the brand is a label for people: "Other" is there
 * so an unlisted make never blocks a sale.
 */
export const PHONE_BRANDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'Samsung', label: 'Samsung' },
  { value: 'Infinix', label: 'Infinix' },
  { value: 'Tecno', label: 'Tecno' },
  { value: 'Xiaomi', label: 'Xiaomi / Redmi / Poco' },
  { value: 'Vivo', label: 'Vivo' },
  { value: 'Oppo', label: 'Oppo' },
  { value: 'Realme', label: 'Realme' },
  { value: 'Huawei', label: 'Huawei' },
  { value: 'Honor', label: 'Honor' },
  { value: 'Itel', label: 'Itel' },
  { value: 'Nokia', label: 'Nokia' },
  { value: 'Motorola', label: 'Motorola' },
  { value: 'Google', label: 'Google Pixel' },
  { value: 'OnePlus', label: 'OnePlus' },
  { value: 'Apple', label: 'Apple iPhone' },
  { value: 'Other', label: 'Other' },
];
