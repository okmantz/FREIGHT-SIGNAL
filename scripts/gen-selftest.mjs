#!/usr/bin/env node
// Generates the FS_SelfTest block of the Outlook macro from the audited email corpus, so the macro is checked against exactly the cases the app is.
//   node scripts/gen-selftest.mjs                     -> prints the VBA block
//   node scripts/gen-selftest.mjs --inject FILE.txt   -> replaces the block between the BEGIN/END GENERATED SELFTEST markers in FILE.txt
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(readFileSync(join(root, 'tests/fixtures/email-corpus.json'), 'utf8'));
const PER_PART = 30;
const BEGIN = "' ==== BEGIN GENERATED SELFTEST (scripts/gen-selftest.mjs) ====";
const END = "' ==== END GENERATED SELFTEST ====";

/** VBA string expression for arbitrary text: quotes doubled, newlines as vbLf, non-ASCII folded to '?', long text split over several statements. */
function vbaText(varName, text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').normalize('NFKD').replace(/[^\x09\x0a\x20-\x7e]/g, '?').replace(/\t/g, ' ');
  const pieces = clean.split('\n').map(l => '"' + l.replace(/"/g, '""') + '"');
  const out = [];
  let cur = varName + ' = ';
  let first = true;
  for (let i = 0; i < pieces.length; i++) {
    const add = (i > 0 ? ' & vbLf & ' : '') + pieces[i];
    if (cur.length + add.length > 700) { out.push(cur); cur = varName + ' = ' + varName + ' & ' + (i > 0 ? 'vbLf & ' : '') + pieces[i]; first = false; }
    else cur += add;
  }
  out.push(cur);
  return out;
}

export function buildBlock() {
  const cases = corpus.cases || [];
  const lines = [];
  lines.push(BEGIN);
  lines.push("' " + cases.length + " cases audited by hand for the app; the macro must read every one the same way. Regenerate after any corpus change.");
  lines.push('Private Sub ST(ByVal nm As String, ByVal body As String, ByVal expectIntent As String, ByVal expectRate As Double, Optional ByVal expectConf As String = "")');
  lines.push('    Dim a As TAnalysis, bad As Boolean');
  lines.push('    AnalyseEmail body, mSelfOwn, a');
  lines.push('    mSelfN = mSelfN + 1');
  lines.push('    bad = (a.Intent <> expectIntent)');
  lines.push('    If expectRate > 0 And a.Rate <> expectRate Then bad = True');
  lines.push('    If expectConf = "weak" And Not a.Weak Then bad = True');
  lines.push('    If expectConf = "strong" And (a.Weak Or Not a.Found) Then bad = True');
  lines.push('    If bad Then');
  lines.push('        mSelfFail = mSelfFail + 1');
  lines.push('        If mSelfFail <= 12 Then mSelfMsg = mSelfMsg & nm & ": expected " & expectIntent & IIf(expectRate > 0, " " & expectRate, "") & ", got " & a.Intent & IIf(a.Found, " " & a.Rate, "") & IIf(a.Weak, " (weak)", "") & vbCrLf')
  lines.push('    End If');
  lines.push('End Sub');
  lines.push('');
  const parts = Math.ceil(cases.length / PER_PART);
  for (let p = 0; p < parts; p++) {
    lines.push('Private Sub ST_Part' + (p + 1) + '()');
    lines.push('    Dim b As String');
    for (const c of cases.slice(p * PER_PART, (p + 1) * PER_PART)) {
      lines.push(...vbaText('b', c.body).map(l => '    ' + l));
      const nm = '"' + String(c.name).normalize('NFKD').replace(/[^\x20-\x7e]/g, '?').replace(/"/g, '""').slice(0, 60) + '"';
      lines.push('    ST ' + nm + ', b, "' + c.intent + '", ' + (Number(c.rate) > 0 ? Number(c.rate) : 0) + (c.confidence === 'weak' || c.confidence === 'strong' ? ', "' + c.confidence + '"' : ''));
    }
    lines.push('End Sub');
    lines.push('');
  }
  lines.push('Public Sub FS_SelfTest()');
  lines.push("    ' Runs the reading rules (from your config file) against the same audited sample replies the app is tested with. Everything should pass.");
  lines.push('    LoadConfig');
  lines.push('    If Not RulesReady() Then MsgBox "The reading rules are not in the config file yet. Open Freight Signal (System page) so it writes the config, then run this again.", vbExclamation, "Freight Signal Engine": Exit Sub');
  lines.push('    mSelfN = 0: mSelfFail = 0: mSelfMsg = ""');
  lines.push(...vbaText('mSelfOwn', corpus.own).map(l => '    ' + l));
  for (let p = 0; p < parts; p++) lines.push('    ST_Part' + (p + 1));
  lines.push('    MsgBox mSelfN - mSelfFail & " of " & mSelfN & " sample replies read correctly." & IIf(mSelfFail > 0, vbCrLf & vbCrLf & mSelfMsg, vbCrLf & "The rules in this Outlook match the app."), IIf(mSelfFail > 0, vbExclamation, vbInformation), "Freight Signal Engine"');
  lines.push('End Sub');
  lines.push(END);
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const block = buildBlock();
  const i = process.argv.indexOf('--inject');
  if (i > 0) {
    const file = process.argv[i + 1];
    let txt = readFileSync(file, 'utf8');
    const crlf = txt.includes('\r\n');
    txt = txt.replace(/\r\n/g, '\n');
    const a = txt.indexOf(BEGIN), b = txt.indexOf(END);
    if (a < 0 || b < 0) { console.error('markers not found in ' + file); process.exit(1); }
    txt = txt.slice(0, a) + block + txt.slice(b + END.length);
    writeFileSync(file, crlf ? txt.replace(/\n/g, '\r\n') : txt);
    console.log('injected ' + (corpus.cases || []).length + ' cases into ' + file);
  } else console.log(block);
}
