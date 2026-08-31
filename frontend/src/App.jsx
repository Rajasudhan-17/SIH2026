import { useState, useEffect, useRef } from 'react';
import './index.css';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [bidders, setBidders] = useState([]);
  const [currentBidderId, setCurrentBidderId] = useState(null);
  const [activeTab, setActiveTab] = useState('checklist');
  const [decisions, setDecisions] = useState({});
  const [auditLogs, setAuditLogs] = useState({});
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContext, setChatContext] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [docModalState, setDocModalState] = useState(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [showAiTag, setShowAiTag] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const fetchBidders = () => {
    fetch('http://localhost:8000/api/bidders')
      .then(res => res.json())
      .then(data => {
        setBidders(data);
        if (data.length > 0 && !currentBidderId) {
          setCurrentBidderId(data[0].id);
        }
        
        // initialize audit logs for any new bidders
        setAuditLogs(prevLogs => {
          const newLogs = { ...prevLogs };
          data.forEach(b => {
            if (!newLogs[b.id]) {
              newLogs[b.id] = [
                { type: 'gold', text: `AI verification engine ran ${b.checks.length} checks across all connected portals.`, time: 'Today · Just now' },
                { type: 'good', text: `Compliance score computed: ${b.score}% · Risk level: ${riskClass(b.score).toUpperCase()}.`, time: 'Today · Just now' }
              ];
              b.checks.filter(c => c.status !== 'verified').forEach(c => {
                newLogs[b.id].push({ type: 'risk', text: `Flagged: ${c.name} — ${c.note}`, time: 'Today · Just now' });
              });
            }
          });
          return newLogs;
        });
      })
      .catch(err => console.error("Error fetching simulated data:", err));
  };

  useEffect(() => {
    if (isLoggedIn) {
      fetchBidders();
    }
  }, [isLoggedIn]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (username === 'admin' && password === 'admin') {
      setIsLoggedIn(true);
    } else {
      alert("Invalid credentials. Try admin / admin");
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    fetch('http://localhost:8000/api/upload', {
      method: 'POST',
      body: formData,
    })
      .then(res => res.json())
      .then(newBidder => {
        setIsUploading(false);
        if (newBidder.id) {
          // fetch full updated list
          fetchBidders();
          setCurrentBidderId(newBidder.id);
          setReasonDraft('');
          setShowAiTag(false);
        } else {
          alert("Upload failed.");
        }
      })
      .catch(err => {
        console.error(err);
        setIsUploading(false);
        alert("Upload error.");
      });
  };

  const riskClass = (score) => score >= 85 ? "low" : score >= 60 ? "med" : "high";
  const riskLabel = { low: "● Low Risk", med: "● Medium Risk", high: "● High Risk" };
  const statusIcon = { verified: "✓", flagged: "!", missing: "×" };

  const currentBidder = bidders.find(b => b.id === currentBidderId);

  const handleDecision = (status) => {
    if (!reasonDraft.trim()) {
      alert("Please provide a reason.");
      return;
    }
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setDecisions(prev => ({
      ...prev,
      [currentBidderId]: { status, reason: reasonDraft, time: `Today · ${time}` }
    }));
    setAuditLogs(prev => ({
      ...prev,
      [currentBidderId]: [
        ...(prev[currentBidderId] || []),
        {
          type: status === 'accepted' ? 'good' : 'risk',
          text: `Officer decision: ${status.toUpperCase()} — "${reasonDraft}"`,
          time: `Today · ${time}`
        }
      ]
    }));
  };

  const generateReason = () => {
    const b = currentBidder;
    const flagged = b.checks.filter(c => c.status !== 'verified');
    const missing = flagged.filter(c => c.status === 'missing');
    const rc = riskClass(b.score);

    if (flagged.length === 0) {
      setReasonDraft(`All ${b.checks.length} statutory and eligibility checks verified with no discrepancies against source portal records. No objections.`);
    } else {
      let reason = `${flagged.length} of ${b.checks.length} compliance checks flagged at ${b.score}% overall compliance (${rc.toUpperCase()} risk): `;
      reason += flagged.map(c => `${c.name} — ${c.note}`).join('; ') + '. ';
      if (rc === 'high') {
        reason += `Given ${missing.length} missing document(s) and unresolved statutory gaps, this bid does not currently meet minimum eligibility for award. Recommend rejection.`;
      } else if (rc === 'med') {
        reason += `Recommend accepting with a formal request for corrected/updated documents before final contract execution.`;
      } else {
        reason += `Recommend accepting as-is, with a note for future tenders.`;
      }
      setReasonDraft(reason);
    }
    setShowAiTag(true);
  };

  const openChat = (focusCheck) => {
    setChatContext(focusCheck);
    setChatHistory([{
      role: 'ai',
      text: focusCheck 
        ? `You're asking about "${focusCheck.name}" for ${currentBidder.name}. Go ahead — I have the full verification trail and submitted documents.`
        : `Ask me anything about ${currentBidder.name}'s compliance report — I have the full verification trail and submitted documents for this bidder.`
    }]);
    setChatOpen(true);
  };

  const sendChatMessage = async (text) => {
    if (!text.trim()) return;
    setChatHistory(prev => [...prev, { role: 'user', text }]);
    setChatInput('');
    setIsChatLoading(true);
    
    try {
      const res = await fetch(`http://localhost:8000/api/chat/${currentBidderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      setChatHistory(prev => [...prev, { role: 'ai', text: data.reply }]);
    } catch (error) {
      console.error("Chat error:", error);
      setChatHistory(prev => [...prev, { role: 'ai', text: "Sorry, I had trouble reaching the verification engine. Please try again." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h2>Verifi Portal Login</h2>
          <form onSubmit={handleLogin}>
            <input type="text" placeholder="Username (admin)" className="login-input" value={username} onChange={e => setUsername(e.target.value)} />
            <input type="password" placeholder="Password (admin)" className="login-input" value={password} onChange={e => setPassword(e.target.value)} />
            <button type="submit" className="login-btn">Login to Platform</button>
          </form>
        </div>
      </div>
    );
  }

  if (!currentBidder && !isUploading) return <div style={{padding: 40}}>Loading simulated data from API...</div>;

  const currentDecision = currentBidderId ? decisions[currentBidderId] : null;
  const rc = currentBidder ? riskClass(currentBidder.score) : "low";

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div>
            <div className="brand-name">Verifi</div>
            <div className="brand-sub">GeM Bid Compliance Engine</div>
          </div>
        </div>
        <div className="topbar-right">
          <div className="tender-chip">GEM/2026/B/2317045 — Supply of Networking Equipment</div>
          <div className="officer-pill" onClick={() => setIsLoggedIn(false)}>
            <div className="officer-avatar">RS</div>
            <span>R. Srinivasan, Procurement Officer</span>
          </div>
        </div>
      </div>

      <div className="sidebar">
        <div className="sidebar-head">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div className="sidebar-title">Bidder Register</div>
            <button 
              onClick={() => fileInputRef.current.click()} 
              style={{
                background: "var(--ink)", color: "#fff", border: "none", borderRadius: 6, 
                padding: "4px 8px", fontSize: 11, cursor: "pointer", fontFamily: "var(--sans)"
              }}
              disabled={isUploading}
            >
              {isUploading ? "Uploading..." : "+ Upload PDF"}
            </button>
            <input type="file" accept="application/pdf" ref={fileInputRef} style={{display:'none'}} onChange={handleFileUpload} />
          </div>
          <div className="sidebar-count">{bidders.length} bidders · verified</div>
        </div>
        <div>
          {bidders.map(b => {
            const dec = decisions[b.id];
            return (
              <div key={b.id} className={`bidder-row ${b.id === currentBidderId ? 'active' : ''}`} onClick={() => { setCurrentBidderId(b.id); setReasonDraft(''); setShowAiTag(false); }}>
                <div className={`bidder-score-dot ${riskClass(b.score)}`}>{b.score}</div>
                <div className="bidder-meta">
                  <div className="bidder-name">{b.name}</div>
                  <div className="bidder-id">{b.id}</div>
                  <div className={`bidder-decision-tag ${dec ? dec.status : 'pending'}`}>
                    {dec ? dec.status.toUpperCase() : 'PENDING DECISION'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {currentBidder && (
      <div className="main">
        <div className="main-head">
          <div className="main-head-left">
            <h1>{currentBidder.name}</h1>
            <div className="sub">Bidder ID <span>{currentBidder.id}</span> · Category: IT & Networking Hardware</div>
          </div>
          <div className="speed-strip">
            <div className="speed-item">
              <div className="speed-label">Manual verification (avg.)</div>
              <div className="speed-value">2h 40m</div>
            </div>
            <div className="speed-divider"></div>
            <div className="speed-item">
              <div className="speed-label">AI verification</div>
              <div className="speed-value gold">0.3s</div>
            </div>
          </div>
        </div>

        <div className="dash-grid">
          <div className="seal-card">
            <div className="seal-wrap">
              <svg viewBox="0 0 170 170">
                <circle className="seal-track" cx="85" cy="85" r="72"/>
                <circle className="seal-fill" cx="85" cy="85" r="72" stroke={rc === 'low' ? '#1E8A5F' : rc === 'med' ? '#B9862F' : '#C1403B'}
                  strokeDasharray="452" strokeDashoffset={452 - (452 * currentBidder.score / 100)}/>
              </svg>
              <div className="seal-center">
                <div className="seal-score">{currentBidder.score}<span>%</span></div>
                <div className="seal-caption">Compliance</div>
              </div>
            </div>
            <div className={`risk-badge ${rc}`}>{riskLabel[rc]}</div>
            <button className="ask-ai-btn" onClick={() => openChat(null)}>
              Ask AI about this score
            </button>
            <div className="seal-stats">
              <div className="seal-stat-row"><span className="k">Docs verified</span><span className="v">{currentBidder.documents.length}/{currentBidder.documents.length}</span></div>
              <div className="seal-stat-row"><span className="k">Flagged items</span><span className="v">{currentBidder.checks.filter(c => c.status !== 'verified').length}</span></div>
              <div className="seal-stat-row"><span className="k">Last checked</span><span className="v">Just now</span></div>
            </div>
          </div>

          <div className="checklist-card">
            <div className="checklist-head">
              <div className="tab-group">
                <button className={`tab-btn ${activeTab === 'checklist' ? 'active' : ''}`} onClick={() => setActiveTab('checklist')}>Compliance Checklist</button>
                <button className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>Submitted Documents</button>
              </div>
              <div className="checklist-sub">
                {activeTab === 'checklist' ? 'cross-verified against source portals' : `${currentBidder.documents.length} files submitted`}
              </div>
            </div>
            <div>
              {activeTab === 'checklist' && currentBidder.checks.map((c, i) => (
                <div className="check-row" key={i}>
                  <div className={`check-icon ${c.status}`}>{statusIcon[c.status]}</div>
                  <div>
                    <div className="check-name">{c.name}</div>
                    <div className="check-note">{c.note}</div>
                  </div>
                  <div className={`check-status-label ${c.status}`}>{c.status.toUpperCase()}</div>
                  <button className="check-ask" onClick={() => openChat(c)}>Ask AI</button>
                </div>
              ))}
              {activeTab === 'documents' && currentBidder.documents.map((d, i) => (
                <div className="doc-row" key={i}>
                  <div className="doc-file-icon">📄</div>
                  <div>
                    <div className="doc-name">{d.name}</div>
                    <div className="doc-meta">{d.size} · uploaded {d.uploaded}</div>
                  </div>
                  <div className={`check-status-label ${d.status}`}>{d.status.toUpperCase()}</div>
                  <button className="doc-view-btn" onClick={() => setDocModalState(d)}>View</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="security-strip">
          <b>🔒 Zero human data exposure</b><div className="security-dot"></div>
          <span>Bidder documents are never manually viewed unless flagged</span><div className="security-dot"></div>
          <span>Bias-free, rule-consistent scoring</span><div className="security-dot"></div>
          <span>Immutable audit trail logged automatically</span>
        </div>

        <div className="decision-grid">
          <div className="decision-card">
            <h3>Officer Decision</h3>
            <div className={`ai-rec-banner ${rc}`}>
              <span>🤖</span>
              <div><b>AI Recommendation</b>{currentBidder.aiRecommendation.replace('AI Recommendation: ','')}</div>
            </div>
            
            {!currentDecision ? (
              <>
                <div className="reason-label-row">
                  <span className="reason-label">Reason for decision (required)</span>
                  <button className="generate-btn" onClick={generateReason}>Generate with AI</button>
                </div>
                <textarea className="reason-input" value={reasonDraft} onChange={e => {setReasonDraft(e.target.value); setShowAiTag(false);}} placeholder="Enter your reasoning..."></textarea>
                {showAiTag && <div className="ai-generated-tag show">✨ Drafted from checklist flags — review before submitting</div>}
                
                <div className="decision-btn-row">
                  <button className="decision-btn accept" onClick={() => handleDecision('accepted')}>✓ Accept Bid</button>
                  <button className="decision-btn reject" onClick={() => handleDecision('rejected')}>✕ Reject Bid</button>
                </div>
              </>
            ) : (
              <div className={`decision-result show ${currentDecision.status}`}>
                <b>{currentDecision.status === 'accepted' ? '✓ Bid Accepted' : '✕ Bid Rejected'}</b><br/>
                Decision logged by R. Srinivasan · {currentDecision.time}
                <div style={{marginTop: 10, fontSize: 12, opacity: 0.8}}>{currentDecision.reason}</div>
              </div>
            )}
          </div>

          <div className="audit-card">
            <div className="audit-head">
              <h3>Audit Trail</h3>
              <div className="sub">{currentBidder.id} · immutable log</div>
            </div>
            <div className="audit-list">
              {auditLogs[currentBidder.id]?.map((log, i) => (
                <div className="audit-item" key={i}>
                  <div className={`audit-dot ${log.type}`}></div>
                  <div>
                    <div className="audit-text">{log.text}</div>
                    <div className="audit-time">{log.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      )}

      {chatOpen && (
        <>
          <div className="chat-overlay open" onClick={() => setChatOpen(false)}></div>
          <div className="chat-drawer open">
            <div className="chat-head">
              <div>
                <div className="chat-head-title">Ask about this score</div>
                <div className="chat-head-sub">{currentBidder?.name}</div>
              </div>
              <button className="chat-close" onClick={() => setChatOpen(false)}>✕</button>
            </div>
            <div className="chat-body">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role}`}>{msg.text}</div>
              ))}
              {isChatLoading && <div className="chat-msg loading">Verifi is thinking…</div>}
            </div>
            {!isChatLoading && (
              <div className="quick-qs">
                <div className="quick-qs-label">Suggested questions</div>
                <button className="quick-q-btn" onClick={() => sendChatMessage("Why did this bidder get this score?")}>Why did this bidder get this score?</button>
                <button className="quick-q-btn" onClick={() => sendChatMessage("What is the biggest risk factor?")}>What is the biggest risk factor?</button>
              </div>
            )}
            <div className="chat-input-row">
              <input className="chat-input" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage(chatInput)} placeholder="Type your question…" />
              <button className="chat-send" onClick={() => sendChatMessage(chatInput)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              </button>
            </div>
          </div>
        </>
      )}

      {docModalState && (
        <>
          <div className="modal-overlay open" onClick={(e) => e.target.classList.contains('modal-overlay') && setDocModalState(null)}>
            <div className="doc-modal">
              <div className="doc-modal-head">
                <div className="doc-modal-title">{docModalState.name}</div>
                <button className="doc-modal-close" onClick={() => setDocModalState(null)}>✕</button>
              </div>
              <div className="doc-modal-body">
                <div className="doc-preview-strip">
                  <div className="doc-preview-icon">📄</div>
                  <div>
                    <div style={{fontSize: 12, color: "var(--ink-muted)"}}>PDF · {docModalState.size} · uploaded {docModalState.uploaded}</div>
                    <div className={`doc-preview-status ${docModalState.status}`}>{docModalState.status.toUpperCase()}</div>
                  </div>
                </div>
                <div className="doc-fields">
                  <div className="doc-fields-label">Extracted fields vs. source portal record</div>
                  {docModalState.fields.map((f, i) => (
                    <div className="doc-field-row" key={i}>
                      <div className="doc-field-k">{f[0]}</div>
                      <div className="doc-field-v">{f[1]}</div>
                      <div className={`doc-field-match ${f[2] ? 'ok' : 'bad'}`}>{f[2] ? '✓' : '⚠'}</div>
                    </div>
                  ))}
                </div>
                <div className="doc-note-block">
                  <b style={{color: "var(--ink)", fontFamily: "var(--sans)"}}>AI note: </b>{docModalState.note}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
