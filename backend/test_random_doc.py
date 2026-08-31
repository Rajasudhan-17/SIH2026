from reportlab.pdfgen import canvas
import os

def create_pdf(filename, text_lines):
    c = canvas.Canvas(filename)
    y = 800
    for line in text_lines:
        c.drawString(50, y, line)
        y -= 20
    c.save()

os.makedirs("test_data", exist_ok=True)

# Completely unstructured invoice
create_pdf("test_data/random_invoice.pdf", [
    "TAX INVOICE",
    "Invoice No: 123456",
    "Dated: 12 Feb 2026",
    "To: Customer Corp",
    "From: Suresh Enterprises Private Limited", # Legal name in plain text
    "123 Business Road, Chennai",
    "Here is our Tax ID 33AACCS1234F1Z5 for your reference.", # GSTIN embedded
    "Also PAN: AACCS1234F", # PAN embedded
    "Our Udyam ID is UDYAM-TN-03-0041827", # Udyam embedded
    "Total: INR 50,000",
    "Thank you!"
])

print("Test PDF created in backend/test_data/random_invoice.pdf")
