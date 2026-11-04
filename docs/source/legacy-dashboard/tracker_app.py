#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tracker App — dashboard comercial editable de Manuel (WhaleCloud).

Sirve en http://localhost:8765 tres pestanas:
  - Salud CRM   : lectura, desde el cache que deja generate_health_dashboard.py
  - Pipeline    : EDITABLE, proyectos y CRs de WOM
  - Facturacion : EDITABLE, facturas y cobranza

La fuente de verdad pasa a ser tracker_data.json (se guarda al instante en disco).
El Excel queda como formato de exportacion para cuando haya que compartirlo.

Uso:
  python3 tracker_app.py              # arranca en :8765
  python3 tracker_app.py --port 9000
  python3 tracker_app.py --reseed     # rehace el JSON desde el Excel
"""
import sys
import json
import argparse
from datetime import datetime, date
from pathlib import Path

from flask import Flask, jsonify, request, send_file, Response

sys.path.insert(0, str(Path(__file__).parent))
import sales_tracker as st

DASH_DIR = Path.home() / "Documents" / "Dashboards"
DATA_FILE = DASH_DIR / "tracker_data.json"
CRM_CACHE = DASH_DIR / "crm_cache.json"
BACKUP_DIR = DASH_DIR / "backups"
EXPORT_FILE = DASH_DIR / "WOM_Sales_Tracker_export.xlsx"

STATUSES = ["PO", "Voucher", "TP Sent", "Preparing TP", "RFP Sent",
            "Preparing RFP", "PVB", "Cancelled"]
RISKS = ["Low", "Medium", "High"]
PAY_STATUSES = ["Not yet invoiced", "Pending", "Paid"]

app = Flask(__name__)


# ----------------------------- almacenamiento -----------------------------

def seed_from_excel():
    path = st.find_tracker()
    if not path:
        return {"wom": [], "new_clients": [], "billing": [], "seeded_from": None}
    d = st.parse(path)
    return {
        "wom": d["wom"],
        "new_clients": d["new_clients"],
        "billing": d["billing"],
        "seeded_from": path.name,
        "seeded_at": datetime.now().isoformat(timespec="seconds"),
    }


def load_data(reseed=False):
    DASH_DIR.mkdir(parents=True, exist_ok=True)
    if reseed or not DATA_FILE.exists():
        data = seed_from_excel()
        DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                             encoding="utf-8")
        return data
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


def save_data(data):
    """Guarda con backup rotativo: nunca perder el estado anterior."""
    DASH_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    if DATA_FILE.exists():
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        (BACKUP_DIR / f"tracker_data_{stamp}.json").write_text(
            DATA_FILE.read_text(encoding="utf-8"), encoding="utf-8")
        backups = sorted(BACKUP_DIR.glob("tracker_data_*.json"))
        for old in backups[:-30]:          # conservar los ultimos 30
            old.unlink(missing_ok=True)
    data["updated_at"] = datetime.now().isoformat(timespec="seconds")
    DATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False),
                         encoding="utf-8")
    return data


# ----------------------------- KPIs -----------------------------

def compute_kpis(data):
    today = date.today()
    wom = data.get("wom", [])
    billing = data.get("billing", [])

    def num(v):
        try:
            return float(v or 0)
        except (TypeError, ValueError):
            return 0.0

    by_status = {}
    for p in wom:
        b = by_status.setdefault(p.get("status", ""), {"count": 0, "expected": 0.0})
        b["count"] += 1
        b["expected"] += num(p.get("expected"))

    closed = sum(v["expected"] for k, v in by_status.items()
                 if k in st.CLOSED_STATUSES)
    in_flight = sum(v["expected"] for k, v in by_status.items()
                    if k not in st.CLOSED_STATUSES and k != "Cancelled")

    def days_to(due):
        if not due:
            return None
        try:
            return (date.fromisoformat(due[:10]) - today).days
        except ValueError:
            return None

    paid = pending = not_inv = overdue_amt = soon_amt = 0.0
    overdue_n = soon_n = 0
    for b in billing:
        amt = num(b.get("usd"))
        stt = (b.get("status") or "").lower()
        d = days_to(b.get("due"))
        if stt == "paid":
            paid += amt
        elif stt == "pending":
            pending += amt
            if d is not None and d < 0:
                overdue_amt += amt
                overdue_n += 1
            elif d is not None and d <= st.PAYMENT_TERM_DAYS:
                soon_amt += amt
                soon_n += 1
        else:
            not_inv += amt

    return {
        "closed": closed,
        "in_flight": in_flight,
        "cancelled": by_status.get("Cancelled", {}).get("expected", 0.0),
        "goal": st.ANNUAL_GOAL_USD,
        "pct": closed / st.ANNUAL_GOAL_USD * 100,
        "pct_pot": (closed + in_flight) / st.ANNUAL_GOAL_USD * 100,
        "new_pipeline": sum(num(n.get("expected")) for n in data.get("new_clients", [])
                            if (n.get("status") or "").lower() not in ("lost", "cancelled")),
        "invoiced": paid + pending,
        "paid": paid,
        "pending": pending,
        "not_invoiced": not_inv,
        "overdue_amount": overdue_amt,
        "overdue_count": overdue_n,
        "due_soon_amount": soon_amt,
        "due_soon_count": soon_n,
        "by_status": by_status,
    }


# ----------------------------- export xlsx -----------------------------

def build_xlsx():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment

    data = load_data()
    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF", size=10)
    head_fill = PatternFill("solid", fgColor="1E293B")

    def sheet(title, headers, rows):
        ws = wb.create_sheet(title)
        ws.append(headers)
        for c in ws[1]:
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(horizontal="center", vertical="center")
        for r in rows:
            ws.append(r)
        for i, h in enumerate(headers, start=1):
            width = max(len(str(h)) + 2,
                        *(len(str(r[i - 1])) + 2 for r in rows)) if rows else len(h) + 2
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(46, width)
        ws.freeze_panes = "A2"
        return ws

    wb.remove(wb.active)
    sheet("WOM Projects",
          ["Status", "PO Number", "Project / CR Name", "Expected Delivery",
           "Expected Amount (USD)", "PO Amount (w/o VAT USD)", "Risk Level",
           "PIC", "Next Action"],
          [[p.get("status", ""), p.get("po", ""), p.get("name", ""),
            p.get("delivery", ""), p.get("expected", 0), p.get("po_net", 0),
            p.get("risk", ""), p.get("pic", ""), p.get("next", "")]
           for p in data.get("wom", [])])

    sheet("New Clients",
          ["Status", "Client", "Project / Solution", "Expected Amount (USD)",
           "Quarter", "Risk Level", "PIC", "Competition", "Next Action"],
          [[n.get("status", ""), n.get("client", ""), n.get("name", ""),
            n.get("expected", 0), n.get("quarter", ""), n.get("risk", ""),
            n.get("pic", ""), n.get("competition", ""), n.get("next", "")]
           for n in data.get("new_clients", [])])

    sheet("Billing Tracker",
          ["Project / CR Name", "Reception Number", "Invoice Amount (USD)",
           "Invoice Number", "Invoice Date", "Payment Due Date", "Payment Status"],
          [[b.get("name", ""), b.get("reception", ""), b.get("usd", 0),
            b.get("invoice_no", ""), b.get("invoice_date", ""),
            b.get("due", ""), b.get("status", "")]
           for b in data.get("billing", [])])

    EXPORT_FILE.parent.mkdir(parents=True, exist_ok=True)
    wb.save(EXPORT_FILE)
    return EXPORT_FILE


# ----------------------------- rutas -----------------------------

@app.route("/api/data")
def api_data():
    d = load_data()
    return jsonify({"data": d, "kpi": compute_kpis(d)})


@app.route("/api/data", methods=["POST"])
def api_save():
    incoming = request.get_json(force=True)
    current = load_data()
    for key in ("wom", "new_clients", "billing"):
        if key in incoming:
            current[key] = incoming[key]
    saved = save_data(current)
    return jsonify({"ok": True, "updated_at": saved["updated_at"],
                    "kpi": compute_kpis(saved)})


@app.route("/api/reseed", methods=["POST"])
def api_reseed():
    d = load_data(reseed=True)
    return jsonify({"ok": True, "seeded_from": d.get("seeded_from")})


@app.route("/api/actualizar-correo", methods=["POST"])
def api_actualizar_correo():
    """Corre actualizar_tracker.py (lee recepciones en el correo y actualiza Facturacion)."""
    import subprocess
    script = Path(__file__).parent / "actualizar_tracker.py"
    try:
        r = subprocess.run([sys.executable, str(script)], capture_output=True,
                           text=True, timeout=280)
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "error": "El correo tardo mas de 280 s"}), 504
    res = None
    for line in r.stdout.splitlines():
        if line.startswith("RESULT "):
            res = json.loads(line[7:])
    if r.returncode != 0 or res is None:
        return jsonify({"ok": False, "error": (r.stderr or r.stdout)[-400:]}), 500
    return jsonify({"ok": True, **res})


@app.route("/export.xlsx")
def export_xlsx():
    path = build_xlsx()
    return send_file(path, as_attachment=True,
                     download_name=f"WOM_Sales_Tracker_{date.today().isoformat()}.xlsx")


@app.route("/api/crm")
def api_crm():
    if CRM_CACHE.exists():
        return Response(CRM_CACHE.read_text(encoding="utf-8"),
                        mimetype="application/json")
    return jsonify({"clients": {}, "generated_at": None})


@app.route("/")
def index():
    return Response(PAGE, mimetype="text/html")


PAGE = r"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<title>Sales Tracker — WhaleCloud</title>
<style>
* { box-sizing:border-box; }
body { margin:0; background:#020617; color:#e2e8f0; font-family:-apple-system,
       BlinkMacSystemFont,"Segoe UI",sans-serif; }
.wrap { max-width:1500px; margin:0 auto; padding:26px 22px 60px; }
h1 { font-size:20px; margin:0 0 4px; }
.sub { color:#94a3b8; font-size:12px; }
.bar { display:flex; align-items:center; gap:10px; margin:18px 0 0; flex-wrap:wrap; }
.tab { background:#0f172a80; border:1px solid #334155; color:#94a3b8; padding:8px 16px;
       border-radius:10px; font-size:12px; cursor:pointer; font-weight:600; }
.tab.on { background:#1e293b; color:#e2e8f0; border-color:#475569; }
.spacer { flex:1; }
.btn { background:#1e293b; border:1px solid #475569; color:#e2e8f0; padding:8px 14px;
       border-radius:9px; font-size:12px; cursor:pointer; font-weight:600; }
.btn:hover { background:#334155; }
.btn.primary { background:#22c55e22; border-color:#22c55e66; color:#4ade80; }
#status { font-size:11px; color:#64748b; min-width:150px; text-align:right; }
#status.dirty { color:#eab308; }
#status.saved { color:#22c55e; }
.pane { display:none; margin-top:18px; }
.pane.on { display:block; }
.kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
        gap:12px; margin-bottom:18px; }
.kbox { background:#0f172a80; border:1px solid #334155; border-radius:12px; padding:14px 16px; }
.kbox .n { font-size:22px; font-weight:700; display:block; font-variant-numeric:tabular-nums; }
.kbox .l { font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:.5px; }
.panel { background:#0f172a80; border:1px solid #334155; border-radius:14px;
         padding:16px 18px; margin-bottom:16px; }
.ptitle { font-size:12px; font-weight:600; color:#e2e8f0; margin-bottom:12px;
          text-transform:uppercase; letter-spacing:.4px; }
table { width:100%; border-collapse:collapse; font-size:11.5px; }
th { text-align:left; color:#94a3b8; font-size:10px; text-transform:uppercase;
     letter-spacing:.5px; padding:6px; border-bottom:1px solid #334155; white-space:nowrap; }
td { padding:3px 4px; border-bottom:1px solid #1e293b; }
input, select { width:100%; background:#0b1220; border:1px solid transparent; color:#e2e8f0;
        font-size:11.5px; padding:5px 6px; border-radius:6px; font-family:inherit; }
input:focus, select:focus { outline:none; border-color:#38bdf8; background:#111c33; }
input.num { text-align:right; font-variant-numeric:tabular-nums; }
.del { background:none; border:none; color:#475569; cursor:pointer; font-size:14px; padding:0 6px; }
.del:hover { color:#ef4444; }
.goalbar { display:flex; background:#1e293b; height:22px; border-radius:11px;
           overflow:hidden; margin-bottom:10px; }
.gf { height:100%; }
.legend { display:flex; gap:18px; flex-wrap:wrap; font-size:11px; color:#94a3b8; }
.legend span { display:inline-flex; align-items:center; gap:6px; }
.ld { width:9px; height:9px; border-radius:50%; display:inline-block; }
.alert { background:#ef444418; border:1px solid #ef444455; color:#fca5a5;
         padding:10px 14px; border-radius:10px; font-size:12px; margin-bottom:16px; }
.warn { background:#eab30818; border:1px solid #eab30855; color:#fde047;
        padding:10px 14px; border-radius:10px; font-size:12px; margin-bottom:16px; }
.muted { color:#64748b; font-size:11px; }
.overdue input { border-left:2px solid #ef4444; }
.soon input { border-left:2px solid #eab308; }
</style></head><body><div class="wrap">
<h1>Sales Tracker — WhaleCloud</h1>
<div class="sub">Jose Manuel Ibieta Martinez &middot; los cambios se guardan en disco al instante</div>

<div class="bar">
  <div class="tab" data-p="crm">Salud CRM</div>
  <div class="tab on" data-p="pipe">Pipeline &amp; Meta</div>
  <div class="tab" data-p="bill">Facturacion</div>
  <div class="spacer"></div>
  <span id="status">Cargando...</span>
  <button class="btn" id="btn-act" onclick="actualizarCorreo()">Actualizar desde correo</button>
  <button class="btn" onclick="exportXlsx()">Exportar Excel</button>
</div>

<div id="pane-crm" class="pane"></div>

<div id="pane-pipe" class="pane on">
  <div class="kpis" id="kpi-pipe"></div>
  <div class="panel">
    <div class="ptitle">Avance hacia la meta anual</div>
    <div class="goalbar"><div class="gf" id="gf-closed" style="background:#22c55e"></div>
      <div class="gf" id="gf-flight" style="background:#38bdf8;opacity:.55"></div></div>
    <div class="legend" id="goal-legend"></div>
  </div>
  <div class="panel">
    <div class="ptitle">Proyectos y CRs de WOM
      <button class="btn" style="float:right;padding:4px 10px" onclick="addWom()">+ Fila</button></div>
    <table id="t-wom"></table>
  </div>
</div>

<div id="pane-bill" class="pane">
  <div class="kpis" id="kpi-bill"></div>
  <div id="bill-alert"></div>
  <div class="panel">
    <div class="ptitle">Facturas y cobranza &mdash; plazo 45 dias
      <button class="btn" style="float:right;padding:4px 10px" onclick="addBill()">+ Fila</button></div>
    <table id="t-bill"></table>
  </div>
</div>
</div>

<script>
const STATUSES = __STATUSES__, RISKS = __RISKS__, PAY = __PAY__;
let D = {wom:[], billing:[], new_clients:[]}, K = {}, timer = null;

function usd(n){ return '$' + Math.round(n||0).toLocaleString('en-US'); }
function daysTo(d){ if(!d) return null;
  const t = Date.parse(d); if(isNaN(t)) return null;
  return Math.round((t - Date.parse(new Date().toISOString().slice(0,10)))/86400000); }

async function actualizarCorreo(){
  const b=document.getElementById('btn-act'); b.disabled=true;
  setStatus('Leyendo recepciones del correo...', 'dirty');
  try{
    const r=await fetch('/api/actualizar-correo',{method:'POST'}); const j=await r.json();
    if(!j.ok){ setStatus('Error: '+(j.error||'').slice(0,80), 'dirty'); b.disabled=false; return; }
    const msg = j.cambios.length ? j.cambios.join('\n') : 'Sin cambios: el tracker ya esta al dia.';
    alert(msg + (j.avisos.length ? '\n\nAvisos:\n'+j.avisos.join('\n') : '') +
      (j.sin_fila ? '\n\n'+j.sin_fila+' recepcion(es) sin fila asignada.' : ''));
    location.reload();
  }catch(e){ setStatus('Error: '+e, 'dirty'); b.disabled=false; }
}

function setStatus(txt, cls){ const e=document.getElementById('status');
  e.textContent=txt; e.className=cls||''; }

function markDirty(){ setStatus('Guardando...', 'dirty');
  clearTimeout(timer); timer=setTimeout(save, 600); }

async function save(){
  const r = await fetch('/api/data', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({wom:D.wom, billing:D.billing, new_clients:D.new_clients})});
  const j = await r.json();
  K = j.kpi; renderKpis();
  setStatus('Guardado ' + j.updated_at.slice(11,16), 'saved');
}

function cell(row, key, type){
  const td = document.createElement('td');
  let el;
  if(type === 'status' || type === 'risk' || type === 'pay'){
    el = document.createElement('select');
    const opts = type==='status'?STATUSES : type==='risk'?RISKS : PAY;
    opts.forEach(o=>{ const op=document.createElement('option');
      op.value=o; op.textContent=o; el.appendChild(op); });
    el.value = row[key] || opts[0];
  } else {
    el = document.createElement('input');
    if(type === 'num'){ el.type='number'; el.className='num'; }
    if(type === 'date'){ el.type='date'; }
    el.value = row[key] == null ? '' : row[key];
  }
  el.onchange = () => { row[key] = (type==='num') ? parseFloat(el.value||0) : el.value;
    markDirty(); renderAll(); };
  td.appendChild(el);
  return td;
}

function delCell(arr, row){
  const td=document.createElement('td');
  const b=document.createElement('button');
  b.className='del'; b.textContent='\u00d7';
  b.title='Eliminar fila';
  b.onclick=()=>{ if(!confirm('Eliminar esta fila?')) return;
    arr.splice(arr.indexOf(row),1); markDirty(); renderAll(); };
  td.appendChild(b); return td;
}

function header(tbl, cols){
  const tr=document.createElement('tr');
  cols.forEach(c=>{ const th=document.createElement('th'); th.textContent=c; tr.appendChild(th); });
  const thead=document.createElement('thead'); thead.appendChild(tr); tbl.appendChild(thead);
}

function renderWom(){
  const t=document.getElementById('t-wom'); t.innerHTML='';
  header(t, ['Estado','OC','Proyecto / CR','Delivery','Esperado USD','OC neto USD','Riesgo','PIC','Proxima accion','']);
  const tb=document.createElement('tbody');
  const order = s => { const i=STATUSES.indexOf(s); return i<0?99:i; };
  D.wom.slice().sort((a,b)=> order(a.status)-order(b.status) || (b.expected||0)-(a.expected||0))
   .forEach(r=>{
    const tr=document.createElement('tr');
    tr.appendChild(cell(r,'status','status'));
    tr.appendChild(cell(r,'po'));
    tr.appendChild(cell(r,'name'));
    tr.appendChild(cell(r,'delivery'));
    tr.appendChild(cell(r,'expected','num'));
    tr.appendChild(cell(r,'po_net','num'));
    tr.appendChild(cell(r,'risk','risk'));
    tr.appendChild(cell(r,'pic'));
    tr.appendChild(cell(r,'next'));
    tr.appendChild(delCell(D.wom, r));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}

function renderBill(){
  const t=document.getElementById('t-bill'); t.innerHTML='';
  header(t, ['Proyecto / CR','Recepcion','Monto USD','N Factura','Emision','Vencimiento','Estado','Dias','']);
  const tb=document.createElement('tbody');
  const rank = r => { const d=daysTo(r.due), s=(r.status||'').toLowerCase();
    if(s==='pending' && d!==null && d<0) return 0;
    if(s==='pending') return 1;
    if(s!=='paid') return 2; return 3; };
  D.billing.slice().sort((a,b)=> rank(a)-rank(b) || ((daysTo(a.due)??9999)-(daysTo(b.due)??9999)))
   .forEach(r=>{
    const tr=document.createElement('tr');
    const d=daysTo(r.due), s=(r.status||'').toLowerCase();
    if(s==='pending' && d!==null && d<0) tr.className='overdue';
    else if(s==='pending' && d!==null && d<=45) tr.className='soon';
    tr.appendChild(cell(r,'name'));
    tr.appendChild(cell(r,'reception'));
    tr.appendChild(cell(r,'usd','num'));
    tr.appendChild(cell(r,'invoice_no'));
    tr.appendChild(cell(r,'invoice_date','date'));
    tr.appendChild(cell(r,'due','date'));
    tr.appendChild(cell(r,'status','pay'));
    const td=document.createElement('td'); td.className='muted';
    td.textContent = (s==='paid'||d===null) ? '\u2014' : (d<0 ? 'vencido '+(-d)+'d' : d+'d');
    if(s!=='paid' && d!==null && d<0) td.style.color='#ef4444';
    tr.appendChild(td);
    tr.appendChild(delCell(D.billing, r));
    tb.appendChild(tr);
  });
  t.appendChild(tb);
}

function kbox(n, l, color){ return '<div class="kbox"><span class="n"' +
  (color?' style="color:'+color+'"':'') + '>'+n+'</span><span class="l">'+l+'</span></div>'; }

function renderKpis(){
  document.getElementById('kpi-pipe').innerHTML =
    kbox(usd(K.closed),'Cerrado (OC + Voucher)','#22c55e') +
    kbox(usd(K.in_flight),'En curso','#38bdf8') +
    kbox(K.pct.toFixed(1)+'%','Meta alcanzada','#22c55e') +
    kbox(K.pct_pot.toFixed(1)+'%','Meta si cierra todo','#38bdf8') +
    kbox(usd(K.new_pipeline),'Pipeline nuevos clientes','#eab308') +
    kbox(usd(K.cancelled),'Cancelado','#64748b');
  document.getElementById('gf-closed').style.width = Math.min(100,K.pct)+'%';
  document.getElementById('gf-flight').style.width = Math.max(0,Math.min(100,K.pct_pot)-K.pct)+'%';
  document.getElementById('goal-legend').innerHTML =
    '<span><i class="ld" style="background:#22c55e"></i>Cerrado '+usd(K.closed)+'</span>' +
    '<span><i class="ld" style="background:#38bdf8"></i>En curso '+usd(K.in_flight)+'</span>' +
    '<span class="muted">Brecha a meta '+usd(Math.max(0,K.goal-K.closed))+'</span>';

  document.getElementById('kpi-bill').innerHTML =
    kbox(usd(K.invoiced),'Facturado') +
    kbox(usd(K.paid),'Cobrado','#22c55e') +
    kbox(usd(K.pending),'Por cobrar','#eab308') +
    kbox(usd(K.overdue_amount),'Vencido ('+K.overdue_count+')','#ef4444') +
    kbox(usd(K.due_soon_amount),'Vence en 45d ('+K.due_soon_count+')','#38bdf8') +
    kbox(usd(K.not_invoiced),'Con OC, sin facturar','#94a3b8');

  const a=document.getElementById('bill-alert');
  if(K.overdue_count) a.innerHTML='<div class="alert">'+K.overdue_count+
    ' factura(s) vencida(s) por '+usd(K.overdue_amount)+' \u2014 gestionar cobranza.</div>';
  else if(K.due_soon_count) a.innerHTML='<div class="warn">'+K.due_soon_count+
    ' factura(s) vencen dentro de 45 dias por '+usd(K.due_soon_amount)+'.</div>';
  else a.innerHTML='';
}

function renderAll(){ renderWom(); renderBill(); renderKpis(); }

function addWom(){ D.wom.push({status:'PVB',po:'',name:'Nueva oportunidad',delivery:'',
  expected:0,po_net:0,risk:'Medium',pic:'Manuel',next:''}); markDirty(); renderAll(); }
function addBill(){ D.billing.push({name:'Nueva factura',reception:'',usd:0,invoice_no:'',
  invoice_date:'',due:'',status:'Not yet invoiced'}); markDirty(); renderAll(); }
function exportXlsx(){ window.location='/export.xlsx'; }

document.querySelectorAll('.tab').forEach(t=>{
  t.onclick=()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.pane').forEach(x=>x.classList.remove('on'));
    t.classList.add('on');
    document.getElementById('pane-'+t.dataset.p).classList.add('on');
  };
});

async function loadCrm(){
  const r = await fetch('/api/crm'); const j = await r.json();
  const box = document.getElementById('pane-crm');
  if(!j.clients || !Object.keys(j.clients).length){
    box.innerHTML='<div class="panel muted">Sin datos de salud CRM todavia. ' +
      'Corre generate_health_dashboard.py para generarlos.</div>'; return; }
  let h='<div class="muted" style="margin-bottom:12px">Generado '+(j.generated_at||'')+
        ' &middot; ventana '+(j.window_days||30)+' dias</div>';
  for(const [name,c] of Object.entries(j.clients)){
    if(!c.total_emails && !c.total_meetings) continue;
    h+='<div class="panel"><div class="ptitle">'+name+
       ' <span class="muted">score '+c.score+'/100 &middot; '+c.active_projects+'/'+
       c.total_projects+' activos &middot; '+c.total_emails+' correos &middot; '+
       (c.total_meetings||0)+' reuniones</span></div><table><tbody>';
    for(const [sec,s] of Object.entries(c.sections)){
      for(const p of s.projects){
        if(!p.total) continue;
        const col = p.score>=70?'#22c55e':p.score>=40?'#eab308':'#ef4444';
        h+='<tr><td style="width:34%"><b>'+p.project+'</b></td><td class="muted">'+sec+
           '</td><td style="color:'+col+'">'+p.score+'</td><td class="muted">'+p.status+
           '</td><td class="muted">IN '+p.inbox+' / OUT '+p.sent+
           (p.meetings?' / MTG '+p.meetings:'')+'</td><td class="muted">'+
           (p.last_days<999?p.last_days+'d':'')+'</td></tr>';
      }
    }
    h+='</tbody></table></div>';
  }
  box.innerHTML=h;
}

(async function(){
  const r = await fetch('/api/data'); const j = await r.json();
  D = j.data; K = j.kpi;
  if(!D.wom) D.wom=[]; if(!D.billing) D.billing=[]; if(!D.new_clients) D.new_clients=[];
  renderAll();
  setStatus(D.updated_at ? 'Guardado '+D.updated_at.slice(11,16) : 'Listo', 'saved');
  loadCrm();
})();
</script></body></html>"""

PAGE = (PAGE.replace("__STATUSES__", json.dumps(STATUSES))
            .replace("__RISKS__", json.dumps(RISKS))
            .replace("__PAY__", json.dumps(PAY_STATUSES)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--reseed", action="store_true")
    args = ap.parse_args()

    if args.reseed:
        d = load_data(reseed=True)
        print(f"Re-sembrado desde {d.get('seeded_from')}: "
              f"{len(d.get('wom', []))} proyectos, {len(d.get('billing', []))} facturas")
        return

    d = load_data()
    if not d.get("wom") and not d.get("billing"):
        print("Aviso: no se encontro el Excel para sembrar. Empiezas con tablas vacias.",
              file=sys.stderr)
    print(f"Datos: {DATA_FILE}")
    print(f"Abre  http://localhost:{args.port}")
    app.run(host="127.0.0.1", port=args.port, debug=False)


if __name__ == "__main__":
    main()
