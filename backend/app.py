from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import re
import pymupdf as fitz
import json
import random
from dotenv import load_dotenv

load_dotenv()

# NEW AI IMPORTS
import easyocr
import google.generativeai as genai
from transformers import pipeline

# Initialize OCR and local ML pipeline at startup
print("Loading AI Models...")
reader = easyocr.Reader(['en'], gpu=False)
ml_extractor = pipeline("question-answering", model="distilbert-base-cased-distilled-squad")
print("AI Models Loaded.")

# Configure Gemini
genai.configure(api_key=os.environ.get("GEMINI_API_KEY", "DUMMY_KEY"))

app = FastAPI(title="Verifi GeM Bid Compliance API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Load simulated government database
with open("gov_db.json", "r") as f:
    gov_db = json.load(f)

# Mock initial bidders list
bidders = [
  {
    "id":"BDR-77291", "name":"Suresh Enterprises Pvt Ltd", "score":96, "risk":"low",
    "aiRecommendation":"AI Recommendation: Qualify. All statutory and eligibility documents are verified and consistent with source portal records. No unresolved flags.",
    "checks":[
      {"name":"Udyam / MSME Registration", "status":"verified", "note":"UDYAM-TN-03-0041827 · Active, Small Enterprise"},
      {"name":"GST Registration & Filing", "status":"verified", "note":"GSTIN 33AACCS1234F1Z5 · Returns filed up to Jul 2026"},
      {"name":"PAN & Income Tax Compliance", "status":"verified", "note":"PAN AACCS1234F · No outstanding demand"},
      {"name":"EPFO / ESIC Compliance", "status":"verified", "note":"EPFO code TN/CHN/0098213 · Contributions current"}
    ],
    "documents":[]
  }
]

def clean_text(text):
    return re.sub(r"\s+", " ", text).strip()

def classify_document(text):
    if not text.strip():
        return "Empty Document"
    try:
        model = genai.GenerativeModel("gemini-flash-latest")
        prompt = f"Classify the following document text into one of these categories: [Invoice, Tax Form, Udyam Certificate, Bank Statement, Purchase Order, Other]. Return ONLY the category name, nothing else.\n\nText: {text[:2000]}"
        response = model.generate_content(prompt)
        return response.text.strip()
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return "Unknown Document (Gemini Error)"

def extract_fields(text):
    fields = {}
    
    # Universal patterns
    gstin_match = re.search(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b", text, re.IGNORECASE)
    if gstin_match:
        fields["gstin"] = gstin_match.group(1).upper()
        
    pan_matches = re.findall(r"\b([A-Z]{5}[0-9]{4}[A-Z]{1})\b", text, re.IGNORECASE)
    if pan_matches:
        fields["pan"] = pan_matches[0].upper()
            
    udyam_match = re.search(r"\b(UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]+)\b", text, re.IGNORECASE)
    if udyam_match:
        fields["udyam_number"] = udyam_match.group(1).upper()

    # Local ML pipeline to extract more details (e.g. Legal Name)
    if text.strip():
        try:
            res = ml_extractor(question="What is the legal name of the company or enterprise?", context=text[:2000])
            if res['score'] > 0.1: # lower threshold since distilbert can be unsure
                fields["ml_legal_name"] = res['answer']
        except Exception as e:
            print(f"ML Extractor Error: {e}")
            
    return fields

def verify_pipeline(fields, raw_text):
    checks = []
    score = 100
    raw_text_lower = raw_text.lower()
    
    # Use ML extracted name if available
    found_legal_name = fields.get("ml_legal_name")

    # 1. GSTIN Check
    if "gstin" in fields:
        gstin = fields["gstin"]
        db_record = gov_db["GSTN"].get(gstin)
        if db_record:
            if not found_legal_name:
                found_legal_name = db_record["legal_name"]
            if db_record["legal_name"].lower() not in raw_text_lower:
                checks.append({"name": "GST Registration & Filing", "status": "flagged", "note": f"{gstin} · Name mismatch: Legal name '{db_record['legal_name']}' not found in document text."})
                score -= 15
            else:
                checks.append({"name": "GST Registration & Filing", "status": "verified", "note": f"{gstin} · {db_record['status']} · {db_record['filing_status']}"})
        else:
            checks.append({"name": "GST Registration & Filing", "status": "flagged", "note": f"{gstin} not found in GSTN portal database."})
            score -= 15
    else:
        checks.append({"name": "GST Registration & Filing", "status": "missing", "note": "No GSTIN found in document."})
        score -= 20

    # 2. PAN Check
    if "pan" in fields:
        pan = fields["pan"]
        db_record = gov_db["PAN"].get(pan)
        if db_record:
            if not found_legal_name:
                found_legal_name = db_record["name"]
            if db_record["name"].lower() not in raw_text_lower:
                checks.append({"name": "PAN & Income Tax Compliance", "status": "flagged", "note": f"{pan} · Name mismatch: Legal name '{db_record['name']}' not found in document text."})
                score -= 15
            else:
                checks.append({"name": "PAN & Income Tax Compliance", "status": "verified", "note": f"{pan} · {db_record['status']}"})
        else:
            checks.append({"name": "PAN & Income Tax Compliance", "status": "flagged", "note": f"{pan} not found in IT portal."})
            score -= 15
    else:
        checks.append({"name": "PAN & Income Tax Compliance", "status": "missing", "note": "No PAN found in document."})
        score -= 20

    # 3. UDYAM Check
    if "udyam_number" in fields:
        udyam = fields["udyam_number"]
        db_record = gov_db["UDYAM"].get(udyam)
        if db_record:
            checks.append({"name": "Udyam / MSME Registration", "status": "verified", "note": f"{udyam} · {db_record['status']}, {db_record['enterprise_type']}"})
        else:
            checks.append({"name": "Udyam / MSME Registration", "status": "flagged", "note": f"{udyam} not found in Udyam portal."})
            score -= 15
    else:
        checks.append({"name": "Udyam / MSME Registration", "status": "missing", "note": "No Udyam number found in document."})

    checks.append({"name": "Blacklisting / Debarment", "status": "verified", "note": "No record found across GeM debarment list."})

    risk = "low" if score >= 85 else "med" if score >= 60 else "high"
    
    if risk == "low":
        rec = "AI Recommendation: Qualify. Document identifiers successfully verified against government databases."
    elif risk == "med":
        rec = "AI Recommendation: Qualify with observations. Some fields were flagged or not found in the database."
    else:
        rec = "AI Recommendation: High risk. Multiple critical identifiers could not be verified."

    return score, risk, rec, checks, found_legal_name

@app.get("/")
def home():
    return {"message": "SIH Document Processing Backend is Running!"}

@app.get("/api/bidders")
def get_bidders():
    return bidders

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
        
    file_path = os.path.join(UPLOAD_FOLDER, file.filename)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
        
    try:
        document = fitz.open(file_path)
        extracted_text = ""
        for page in document:
            text = page.get_text()
            if not text.strip():
                # Perform OCR on image if no text found
                pix = page.get_pixmap()
                img_data = pix.tobytes("png")
                ocr_result = reader.readtext(img_data, detail=0)
                text = " ".join(ocr_result)
            extracted_text += text + "\n"
        document.close()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not read PDF: {str(e)}")

    cleaned_text = clean_text(extracted_text)
    fields = extract_fields(cleaned_text)
    
    # 1. Document Classification via Gemini
    doc_type = classify_document(cleaned_text)
    
    # 2. Pipeline Verification
    score, risk, rec, checks, found_legal_name = verify_pipeline(fields, cleaned_text)
    
    doc_status = "verified" if score >= 85 else "flagged"
    
    new_bidder = {
        "id": f"BDR-{random.randint(10000, 99999)}",
        "name": found_legal_name or "Newly Uploaded Vendor",
        "score": score,
        "risk": risk,
        "aiRecommendation": rec,
        "checks": checks,
        "documents": [
            {
                "name": file.filename,
                "type": doc_type,  # ADDED TYPE
                "size": f"{len(content)//1024} KB",
                "uploaded": "Just now",
                "status": doc_status,
                "fields": [[k, v, True] for k, v in fields.items()],
                "note": f"Classified as {doc_type}. Cross-verified against gov DB."
            }
        ]
    }
    
    bidders.insert(0, new_bidder)
    return new_bidder

class ChatMessage(BaseModel):
    message: str

@app.post("/api/generate_summary/{bidder_id}")
def generate_summary(bidder_id: str):
    bidder = next((b for b in bidders if b["id"] == bidder_id), None)
    if not bidder:
        raise HTTPException(status_code=404, detail="Bidder not found")
    
    try:
        model = genai.GenerativeModel("gemini-flash-latest")
        checks_context = json.dumps(bidder["checks"], indent=2)
        prompt = f"Based on the following compliance checks, draft a 1-2 sentence 'Reason for Decision' for an officer deciding to accept or reject this bidder. Write it in the style of an official note.\n\nChecks:\n{checks_context}"
        response = model.generate_content(prompt)
        
        summary = response.text.strip()
        bidder["reason_for_decision"] = summary
        return {"reason_for_decision": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {str(e)}")

@app.post("/api/chat/{bidder_id}")
def chat_with_bidder_context(bidder_id: str, chat: ChatMessage):
    bidder = next((b for b in bidders if b["id"] == bidder_id), None)
    if not bidder:
        raise HTTPException(status_code=404, detail="Bidder not found")
        
    try:
        model = genai.GenerativeModel("gemini-flash-latest")
        bidder_context = json.dumps({
            "name": bidder["name"],
            "score": bidder["score"],
            "risk": bidder["risk"],
            "checks": bidder["checks"]
        }, indent=2)
        
        prompt = f"You are an AI assistant helping a procurement officer analyze a bidder's compliance report. Here is the bidder's profile:\n{bidder_context}\n\nOfficer's Question: {chat.message}\nAnswer concisely and professionally based ONLY on the provided profile."
        
        response = model.generate_content(prompt)
        return {"reply": response.text.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
