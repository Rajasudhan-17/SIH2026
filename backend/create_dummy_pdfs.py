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

# 1. Perfect match against gov_db (Suresh Enterprises)
create_pdf("test_data/perfect_match_suresh.pdf", [
    "Company Name: Suresh Enterprises Private Limited",
    "GSTIN: 33AACCS1234F1Z5",
    "PAN: AACCS1234F",
    "Udyam Registration Number: UDYAM-TN-03-0041827",
    "Date of Registration: 14 Jan 2019",
    "GST Registration Status: Active"
])

# 2. Perfect match against gov_db (TechNova Solutions)
create_pdf("test_data/perfect_match_technova.pdf", [
    "TECHNOVA SOLUTIONS - OFFICIAL INVOICE",
    "Legal Name: TechNova Solutions",
    "We are billing you for software services rendered.",
    "Our GSTIN is 27AADPT3344M1Z2 for tax purposes.",
    "PAN: AADPT3344M",
    "Udyam Registration: UDYAM-MH-12-0012345",
    "Thank you for your business!"
])

# 3. Partial mismatch (Wrong PAN and GSTIN typo)
create_pdf("test_data/partial_mismatch_vikram.pdf", [
    "Vikram Traders - Compliance Report",
    "Company Name: Vikram Traders",
    "GSTIN: 07AACPV9821K1ZZ",  # Typo here (should be ZP)
    "PAN: INVALIDPAN",
    "Udyam Registration Number: UDYAM-DL-01-0022913",
    "Date of Registration: 12 Feb 2020",
    "GST Registration Status: Active"
])

# 4. Fake document (Forged Identifiers not in DB)
create_pdf("test_data/fake_document_forged.pdf", [
    "FakeCorp Logistics - Purchase Order",
    "Legal Name: FakeCorp Logistics",
    "GSTIN: 99ZZZZZ9999Z9Z9",
    "PAN: ZZZZZ9999Z",
    "Udyam Registration: UDYAM-XX-99-9999999",
    "These identifiers do not exist in the simulated database.",
    "This document should be flagged as high risk."
])

# 5. Name mismatch (Valid IDs but wrong legal name on document)
create_pdf("test_data/name_mismatch.pdf", [
    "Invoice from: Random Unregistered Company",
    "Legal Name: Random Unregistered Company",
    "Using someone else's GSTIN: 33AACCS1234F1Z5",
    "Using someone else's PAN: AACCS1234F",
    "This should flag a name mismatch during verification."
])

print("Test PDFs created successfully in backend/test_data/")
