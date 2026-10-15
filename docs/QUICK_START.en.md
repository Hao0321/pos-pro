# POS Pro — quick start

All stores. All features free. No subscription or paid feature unlocks.

On your first visit, a supported device language is selected automatically. You can always choose **English** on the sign-in screen. Tap the **Bright & simple** preview for a light interface, or keep **Poster style**. After signing in on a phone, use the language icon at the top to change language or appearance. Your saved choice takes priority over the device language.

1. Install the Windows desktop app and create your own administrator account.
2. Open **Products & stock**. Add actual product names, prices, units, costs and quantities.
3. Open **Open & close your store**, check opening cash and start a shift.
4. Choose **Sell & collect payment**. Select products, check the amount and confirm actual payment.
5. Back up your data and test your printer before serving customers.

**Customers & ordering (CRM)** helps with members, points, balances and orders. **Store operations (ERP)** helps with products, purchases, stock, payments and accounts. Both use the same store data.

**Quick entry** can accept a complete Agent document reply. Review products, quantities and prices before confirming. Language changes keep unfinished drafts and their original IDs. If a save result is uncertain, check or retry the original transaction instead of collecting payment again.

To share a store with a phone, start **Shared store** in the Windows app. Use the same private Wi-Fi or hotspot, verify and trust the store certificate, then use the single-use pairing link and sign in. Keep the computer and POS running. The phone can use a different display language; saving requires a connection to the store computer.

Language does not change currency or tax jurisdiction. This version retains the store's existing TWD/NT$ accounting rules. Your product names and notes stay exactly as entered. Full ERP and enterprise CRM remain in development. Translations still need native-speaker review.

The current Windows build is unsigned and uses manual updates. Back up before updating. See the [installer notes](INSTALLER_2_13_1.md) and [language/style details](LANGUAGE_AND_STYLE.md).

## Quotes and catalogues

Search for **quote** on Home. In **Quotes & catalogues**, paste the buyer's store card, choose products and their prices, then confirm the all-inclusive TWD total and expiry date. Save the quote, then copy or download it to send yourself. Previous revisions stay available, and each customer's suggested prices are remembered separately.

To buy, share **Copy my store card** with your supplier. Paste their quotation in **Quick entry**, check the product mapping, supplier, date and total, then confirm the purchase. Receiving goods and paying remain separate actions.

The catalogue download contains only selected products and reference prices. A store card or recipient ID does not authenticate a company or encrypt the file. Verify the sender and recipient through your agreed channel. Third-party ERP/Agent support is available through the public JSON schemas; independent interoperability and native-speaker review remain open.

## Sales and receivables

Open an agreed quote and choose **Customer accepted: create sales order**, or search for **receivables** on Home and create a manual order. Review the customer, quantities and agreed prices, then confirm. This saves an order without deducting or reserving stock or collecting money.

Use **Next: hand over the goods** only after the agreed handover; enter this batch and its payment due date. Then use **Record this payment** for money actually received, including partial payments. Cash requires an open shift. A bank entry records a payment you verified; it does not charge anyone. Returns and allowances stay tied to the original handover, refunds to the original payment, and corrections preserve history. Original cost feeds reports and accounting even after repricing. If saving is uncertain, use **Check the original result**.

For advance money or one payment covering several bills, use **Customers & balances**. Add or select a customer, record money actually received, then review **Apply money to bills** after goods handover. This allocates the original receipt without collecting it again. Release an allocation before returning that part of an advance; refunds retain the original payment method. An uncertain result keeps its original ID and draft. See the [customer guide](CUSTOMER_GUIDE.md).

This is an internal TWD all-inclusive goods workflow. Complete stock allocation, tax invoices and period close remain in development. See the [sales guide](SALES_GUIDE.md).
