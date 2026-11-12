/**
 * Sends the browser to a payment gateway's hosted page.
 *
 * Gateways such as JazzCash take the checkout as a form POST, not a link, so
 * this builds a hidden form from the fields the server signed and submits it.
 * The fields are passed through untouched — changing any of them would break
 * the signature, which is the point of it.
 */
export function postToGateway(redirect: { url: string; fields: Record<string, string> }): void {
  const target = new URL(redirect.url);
  if (target.protocol !== 'https:') {
    throw new Error('The payment page address is not secure. Payment was not started.');
  }

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = target.toString();
  form.style.display = 'none';

  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
}
