"""Builds 'Stair Design.xlsx': the in-app stair span analysis and IS 456 design (web/src/stair/stair.ts) as live Excel formulas,
with the section, loading, shear and moment diagrams drawn by Excel charts from the same cells.

One sheet per span. Copy a span sheet to add a span: its charts follow the copy. Run: python build_stair_xlsx.py
"""
from openpyxl import Workbook
from openpyxl.chart import AreaChart, Reference, ScatterChart, Series
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.drawing.line import LineProperties
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as CL
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

F = 'Arial'
INP = dict(font=Font(name=F, color='0000FF'), fill=PatternFill('solid', fgColor='FFFF99'))
LINK = Font(name=F, color='008000')
HDR = dict(font=Font(name=F, bold=True, color='FFFFFF'), fill=PatternFill('solid', fgColor='1F4E78'))
SUB = dict(font=Font(name=F, bold=True), fill=PatternFill('solid', fgColor='DDEBF7'))
thin = Side(style='thin', color='999999')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
OK_FILL, BAD_FILL = PatternFill('solid', fgColor='C6EFCE'), PatternFill('solid', fgColor='FFC7CE')

NSEG, NTR = 6, 2  # segment and transfer rows per span
SEG0, TR0, SUP0, LD0 = 11, 20, 24, 29  # first rows of the blocks
NPTS = 62  # profile points per segment slot: 2n + 2 with n ≤ 30 risers
NX = 500  # statics sampled at L·i/500, as ssBeam does


def put(ws, ref, v, style=None, fmt=None):
    c = ws[ref]
    c.value = v
    c.font = Font(name=F)
    if style:
        for k, s in style.items():
            setattr(c, k, s)
    if fmt:
        c.number_format = fmt
    return c


def inp(ws, ref, v, fmt=None):
    c = put(ws, ref, v, INP, fmt)
    c.border = BOX
    return c


def header(ws, row, cols, start=1):
    for i, t in enumerate(cols):
        c = put(ws, f'{CL(start + i)}{row}', t, SUB)
        c.alignment = Alignment(wrap_text=True, vertical='center', horizontal='center')
        c.border = BOX


def title(ws, ref, t):
    put(ws, ref, t, HDR)


# ---------------------------------------------------------------- parameters + IS 456 tables
def parameters(wb):
    ws = wb.active
    ws.title = 'Parameters'
    ws.column_dimensions['A'].width = 44
    ws.column_dimensions['B'].width = 12
    ws.column_dimensions['C'].width = 12
    ws.column_dimensions['D'].width = 60
    put(ws, 'A1', 'Stair design — shared materials and loads', dict(font=Font(name=F, bold=True, size=14)))
    put(ws, 'A2', 'Edit only the yellow cells (blue text). Black cells are formulas; green cells link to another sheet.')
    put(ws, 'A3', 'Same method as the Stair app: per span, a simply supported 1 m strip (IS 456 cl 33), loads per m² of plan.')
    title(ws, 'A5', 'Parameter')
    title(ws, 'B5', 'Value')
    title(ws, 'C5', 'Unit')
    title(ws, 'D5', 'Note')
    rows = [
        ('p_fck', 'Concrete grade fck', 25, 'N/mm²', 'IS 456 Table 2'),
        ('p_fy', 'Steel grade fy', 500, 'N/mm²', 'Fe 415 / Fe 500'),
        ('p_cover', 'Clear cover', 20, 'mm', 'IS 456 Table 16'),
        ('p_bar', 'Main bar diameter', 12, 'mm', ''),
        ('p_dbar', 'Distribution bar diameter', 8, 'mm', ''),
        ('p_ff', 'Floor finish', 1.5, 'kN/m²', 'tread + riser finish and soffit plaster'),
        ('p_ll', 'Live load q', 4, 'kN/m²', 'IS 875 Part 2'),
        ('p_gc', 'Unit weight of RCC γc', 25, 'kN/m³', 'IS 875 Part 1'),
        ('p_gf', 'Load factor γf', 1.5, '', 'IS 456 Table 18'),
    ]
    for i, (nm, lab, v, u, note) in enumerate(rows):
        r = 6 + i
        put(ws, f'A{r}', lab)
        inp(ws, f'B{r}', v)
        put(ws, f'C{r}', u)
        put(ws, f'D{r}', note)
        wb.defined_names[nm] = DefinedName(nm, attr_text=f'Parameters!$B${r}')
    # IS 456 Table 19 (τc) and Table 20 (τc,max)
    title(ws, 'A17', 'IS 456 Table 19 — τc (N/mm²) by 100As/bd (row 18) and grade (column A)')
    pts = [0.15, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]
    tc = {
        15: [0.28, 0.35, 0.46, 0.54, 0.6, 0.64, 0.68, 0.71, 0.71, 0.71, 0.71, 0.71, 0.71],
        20: [0.28, 0.36, 0.48, 0.56, 0.62, 0.67, 0.72, 0.75, 0.79, 0.81, 0.82, 0.82, 0.82],
        25: [0.29, 0.36, 0.49, 0.57, 0.64, 0.7, 0.74, 0.78, 0.82, 0.85, 0.88, 0.9, 0.92],
        30: [0.29, 0.37, 0.5, 0.59, 0.66, 0.71, 0.76, 0.8, 0.84, 0.88, 0.91, 0.94, 0.96],
        35: [0.29, 0.37, 0.5, 0.59, 0.67, 0.73, 0.78, 0.82, 0.86, 0.9, 0.93, 0.96, 0.99],
        40: [0.3, 0.38, 0.51, 0.6, 0.68, 0.74, 0.79, 0.84, 0.88, 0.92, 0.95, 0.98, 1.01],
    }
    tcmax = {15: 2.5, 20: 2.8, 25: 3.1, 30: 3.5, 35: 3.7, 40: 4.0}
    put(ws, 'A18', 'grade \\ pt', SUB)
    for j, p in enumerate(pts):
        put(ws, f'{CL(2 + j)}18', p, SUB)
    put(ws, 'O18', 'τc,max (T20)', SUB)
    for i, g in enumerate(tc):
        r = 19 + i
        put(ws, f'A{r}', g, SUB)
        for j, v in enumerate(tc[g]):
            put(ws, f'{CL(2 + j)}{r}', v)
        put(ws, f'O{r}', tcmax[g])
    for nm, ref in [('t_pt', '$B$18:$N$18'), ('t_grade', '$A$19:$A$24'), ('t_tc', '$B$19:$N$24'), ('t_tcmax', '$O$19:$O$24')]:
        wb.defined_names[nm] = DefinedName(nm, attr_text=f'Parameters!{ref}')


# ---------------------------------------------------------------- one span sheet
def span_sheet(wb, name, ex):
    ws = wb.create_sheet(name)
    ws.sheet_view.zoomScale = 85
    for col, w in zip('ABCDEFGHIJKLMNOPQRSTU', [26, 12, 10, 9, 9, 9, 11, 10, 8, 9, 9, 11, 9, 10, 10, 10, 10, 10, 10, 10, 10]):
        ws.column_dimensions[col].width = w
    segs = f'$B${SEG0}:$B${SEG0 + NSEG - 1}'
    put(ws, 'A1', f'Stair span {ex["name"]} — analysis and IS 456 design', dict(font=Font(name=F, bold=True, size=14)))
    put(ws, 'A2', 'Yellow = input. Segments are listed from end A in walking order along the strip; flights rise from A towards B.')

    title(ws, 'A4', 'Span')
    put(ws, 'A5', 'Span name')
    inp(ws, 'B5', ex['name'])
    put(ws, 'A6', 'Strip width w (mm)')
    inp(ws, 'B6', ex['width'])
    put(ws, 'A7', 'Slab level at end A (mm)')
    inp(ws, 'B7', ex['zA'])
    put(ws, 'A8', 'Effective span L (m, c/c of supports)')
    put(ws, 'B8', f'=K{SEG0 + NSEG - 1}', fmt='0.000')

    # segments
    title(ws, f'A{SEG0 - 2}', 'Segments along the strip (from A)')
    header(ws, SEG0 - 1, ['Name', 'Type', 'n risers', 'R (mm)', 'T (mm)', 't waist / slab (mm)', 'Landing length in span (m)', 'Length (m)', 'k (cl 33.2)',
                          'a (m)', 'b (m)', 'Level at start (mm)', 'sec θ', 'w_w (kN/m²)', 'w_s steps', 'w_ff', 'g = DL', 'q = LL', 'w_u', 'DL × k', 'LL × k'])
    dv_type = DataValidation(type='list', formula1='"Flight,Landing"', allow_blank=True)
    dv_n = DataValidation(type='whole', operator='between', formula1='2', formula2='30', allow_blank=True)
    dv_k = DataValidation(type='list', formula1='"1,0.5"', allow_blank=True)
    for dv in (dv_type, dv_n, dv_k):
        ws.add_data_validation(dv)
    for i in range(NSEG):
        r = SEG0 + i
        s = ex['segs'][i] if i < len(ex['segs']) else {}
        for col, key, fmt in [('A', 'name', None), ('B', 'type', None), ('C', 'n', '0'), ('D', 'R', '0'), ('E', 'T', '0'), ('F', 't', '0'), ('G', 'len', '0.000'), ('I', 'k', '0.0')]:
            inp(ws, f'{col}{r}', s.get(key), fmt)
        dv_type.add(f'B{r}')
        dv_n.add(f'C{r}')
        dv_k.add(f'I{r}')
        put(ws, f'H{r}', f'=IF(B{r}="Flight",(C{r}-1)*E{r}/1000,IF(B{r}="Landing",G{r},0))', fmt='0.000')
        put(ws, f'J{r}', 0 if i == 0 else f'=K{r - 1}', fmt='0.000')
        put(ws, f'K{r}', f'=J{r}+H{r}', fmt='0.000')
        put(ws, f'L{r}', '=$B$7' if i == 0 else f'=L{r - 1}+IF(B{r - 1}="Flight",C{r - 1}*D{r - 1},0)', fmt='0')
        put(ws, f'M{r}', f'=IF(B{r}="Flight",SQRT(D{r}^2+E{r}^2)/E{r},1)', fmt='0.0000')
        put(ws, f'N{r}', f'=IF(B{r}="",0,p_gc*F{r}/1000*M{r})', fmt='0.000')
        put(ws, f'O{r}', f'=IF(B{r}="Flight",p_gc*D{r}/2000,0)', fmt='0.000')
        put(ws, f'P{r}', f'=IF(B{r}="",0,p_ff)', fmt='0.000')
        put(ws, f'Q{r}', f'=N{r}+O{r}+P{r}', fmt='0.000')
        put(ws, f'R{r}', f'=IF(B{r}="",0,p_ll)', fmt='0.000')
        put(ws, f'S{r}', f'=p_gf*(Q{r}+R{r})', fmt='0.000')
        put(ws, f'T{r}', f'=Q{r}*I{r}', fmt='0.000')
        put(ws, f'U{r}', f'=R{r}*I{r}', fmt='0.000')
    put(ws, f'A{SEG0 + NSEG}', 'Flight length = (n − 1)·T. w_w = γc·t·secθ, w_s = γc·R/2, g = w_w + w_s + w_ff. k = 0.5 where a landing is common to two spans at right angles (IS 456 cl 33.2).',
        dict(font=Font(name=F, italic=True, size=9)))

    # transfers: end reactions of other spans resting on this one
    title(ws, f'A{TR0 - 2}', 'Spans resting on this one (their end reaction, IS 456 cl 33.1 b)')
    header(ws, TR0 - 1, ['From span', 'R_DL (kN/m)', 'R_LL (kN/m)', 'Its width (mm)', 'Bearing centre from A (m)', 'Angle between spans (°)',
                         'Bearing length (m)', 'a (m)', 'b (m)', 'Spread factor', 'DL (kN/m²)', 'LL (kN/m²)'])
    for i in range(NTR):
        r = TR0 + i
        t = ex['tr'][i] if i < len(ex['tr']) else {}
        for col, key, fmt in [('A', 'from', None), ('B', 'RD', '0.000'), ('C', 'RL', '0.000'), ('D', 'w', '0'), ('E', 'at', '0.000'), ('F', 'ang', '0')]:
            c = inp(ws, f'{col}{r}', t.get(key), fmt)
            if isinstance(t.get(key), str) and t[key].startswith('='):
                c.font = LINK
        # shortcut: a bearing parallel to this span's axis is spread over 50 mm, as in the app
        put(ws, f'G{r}', f'=MAX(0.05,D{r}/1000*ABS(SIN(RADIANS(F{r}))))', fmt='0.000')
        put(ws, f'H{r}', f'=MAX(0,MIN($B$8-G{r},E{r}-G{r}/2))', fmt='0.000')
        put(ws, f'I{r}', f'=H{r}+G{r}', fmt='0.000')
        put(ws, f'J{r}', f'=D{r}/$B$6/G{r}', fmt='0.0000')
        put(ws, f'K{r}', f'=B{r}*J{r}', fmt='0.000')
        put(ws, f'L{r}', f'=C{r}*J{r}', fmt='0.000')

    # supports and what they get
    title(ws, f'A{SUP0 - 2}', 'Supports — line loads on the beams (unfactored D, L and factored U per m along the beam, over the strip width)')
    header(ws, SUP0 - 1, ['End', 'Support', 'Beam / span name', 'Beam width (mm)', 'Beam depth (mm)', 'Slab level (mm)',
                          'R_D (kN/m)', 'R_L (kN/m)', 'R_U (kN/m)', 'Total D (kN)', 'Total L (kN)', 'Total U (kN)'])
    dv_sup = DataValidation(type='list', formula1='"Beam,Rests on span,Wall"', allow_blank=False)
    ws.add_data_validation(dv_sup)
    for i, sup in enumerate(ex['sup']):
        r = SUP0 + i
        put(ws, f'A{r}', 'A' if i == 0 else 'B', dict(font=Font(name=F, bold=True)))
        inp(ws, f'B{r}', sup['type'])
        dv_sup.add(f'B{r}')
        inp(ws, f'C{r}', sup['name'])
        inp(ws, f'D{r}', sup.get('bw', 300), '0')
        inp(ws, f'E{r}', sup.get('bd', 500), '0')
        put(ws, f'F{r}', '=$B$7' if i == 0 else f'=$B$7+SUMPRODUCT(({segs}="Flight")*$C${SEG0}:$C${SEG0 + NSEG - 1}*$D${SEG0}:$D${SEG0 + NSEG - 1})', fmt='0')
        rr = 40 + i  # RA / RB rows of the statics block
        for col, src in zip('GHI', 'BCD'):
            put(ws, f'{col}{r}', f'={src}{rr}', fmt='0.000')
        for col, src in zip('JKL', 'GHI'):
            put(ws, f'{col}{r}', f'={src}{r}*$B$6/1000', fmt='0.00')
    put(ws, f'A{SUP0 + 2}', '=IF(B25="Rests on span","End B rests on "&C25&": enter R_D = "&TEXT(B41,"0.000")&" and R_L = "&TEXT(C41,"0.000")&" kN/m as a transfer row on that span\'s sheet.",'
        'IF(B24="Rests on span","End A rests on "&C24&": enter R_D = "&TEXT(B40,"0.000")&" and R_L = "&TEXT(C40,"0.000")&" kN/m as a transfer row on that span\'s sheet.",""))',
        dict(font=Font(name=F, italic=True, color='C00000')))

    # loads for the statics
    title(ws, f'A{LD0 - 2}', 'Loads on the strip (per m width)')
    header(ws, LD0 - 1, ['Load', 'a (m)', 'b (m)', 'DL (kN/m²)', 'LL (kN/m²)', 'w_u = γf(DL+LL)'])
    for i in range(NSEG + NTR):
        r = LD0 + i
        if i < NSEG:
            s = SEG0 + i
            vals = [f'=IF(A{s}="","",A{s})', f'=J{s}', f'=K{s}', f'=T{s}', f'=U{s}']
        else:
            s = TR0 + i - NSEG
            vals = [f'=IF(A{s}="","","R("&A{s}&")")', f'=H{s}', f'=I{s}', f'=K{s}', f'=L{s}']
        for col, v in zip('ABCDE', vals):
            put(ws, f'{col}{r}', v, fmt='0.000')
        put(ws, f'F{r}', f'=p_gf*(D{r}+E{r})', fmt='0.000')
    LA, LB = f'$B${LD0}:$B${LD0 + 7}', f'$C${LD0}:$C${LD0 + 7}'

    # statics
    title(ws, 'A38', 'Statics — simply supported strip (per m width)')
    header(ws, 39, ['', 'Dead D', 'Live L', 'Factored U'])
    put(ws, 'A39', 'Quantity', SUB)
    xc = 'BB'  # x column of the sampled table
    for col, w, mcol in [('B', 'D', 'BF'), ('C', 'E', 'BG'), ('D', 'F', 'BH')]:
        W = f'${w}${LD0}:${w}${LD0 + 7}'
        put(ws, f'{col}43', f'=SUMPRODUCT({W},{LB}-{LA})', fmt='0.000')
        put(ws, f'{col}41', f'=SUMPRODUCT({W},{LB}-{LA},({LA}+{LB})/2)/$B$8', fmt='0.000')
        put(ws, f'{col}40', f'={col}43-{col}41', fmt='0.000')
        rng = f'${mcol}$3:${mcol}${3 + NX}'
        put(ws, f'{col}42', f'=MAX(0,MAX({rng}))', fmt='0.000')
        put(ws, f'{col}44', f'=INDEX(${xc}$3:${xc}${3 + NX},MATCH(MAX({rng}),{rng},0))', fmt='0.000')
    for r, lab in [(40, 'Reaction RA at A (kN/m)'), (41, 'Reaction RB at B (kN/m)'), (42, 'Max moment M (kNm/m)'), (43, 'Total load W (kN/m)'), (44, 'x of max moment from A (m)')]:
        put(ws, f'A{r}', lab)

    # IS 456 design
    title(ws, 'A46', 'IS 456 design — 1 m wide strip, factored loads')
    header(ws, 47, ['Quantity', 'Value', 'Unit', 'Formula / clause'])
    tmin = (f'=IF(COUNTIF({segs},"Flight")>0,_xlfn.MINIFS($F${SEG0}:$F${SEG0 + NSEG - 1},{segs},"Flight"),'
            f'IF(COUNTIF({segs},"Landing")>0,_xlfn.MINIFS($F${SEG0}:$F${SEG0 + NSEG - 1},{segs},"Landing"),150))')
    D = [  # (key, label, formula, unit, note, fmt)
        ('D', 'Overall depth D', tmin, 'mm', 'thinnest flight waist on the span', '0'),
        ('b', 'Strip width b', '=1000', 'mm', '', '0'),
        ('d', 'Effective depth d', '={D}-p_cover-p_bar/2', 'mm', 'D − cover − φ/2', '0.0'),
        ('Mu', 'Factored moment Mu', '=D42', 'kNm/m', 'from statics', '0.000'),
        ('Vu', 'Factored shear Vu', '=MAX(D40,D41)', 'kN/m', 'larger reaction', '0.000'),
        ('xr', 'xu,max / d', '=0.0035/(0.0055+0.87*p_fy/200000)', '', 'cl 38.1', '0.0000'),
        ('Q', 'Q = 0.36 fck xr (1 − 0.42 xr)', '=0.36*p_fck*{xr}*(1-0.42*{xr})', 'N/mm²', 'Annex G', '0.0000'),
        ('Mlim', 'Limiting moment Mu,lim', '={Q}*{b}*{d}^2/1E6', 'kNm/m', 'Q b d²', '0.000'),
        ('dReq', 'd required', '=SQRT({Mu}*1E6/({Q}*{b}))', 'mm', '√(Mu / Q b)', '0.0'),
        ('disc', 'Discriminant 1 − 4.6 Mu / (fck b d²)', '=1-4.6*{Mu}*1E6/(p_fck*{b}*{d}^2)', '', '> 0 for an under-reinforced section', '0.0000'),
        ('Ast', 'Ast required for Mu', '=IF({disc}>0,0.5*p_fck/p_fy*(1-SQRT({disc}))*{b}*{d},NA())', 'mm²/m', 'Annex G-1.1 b', '0.0'),
        ('Amin', 'Ast minimum', '=IF(p_fy>250,0.0012,0.0015)*{b}*{D}', 'mm²/m', 'cl 26.5.2.1', '0.0'),
        ('Areq', 'Ast to provide', '=MAX({Ast},{Amin})', 'mm²/m', '', '0.0'),
        ('sMax', 'Max spacing, main', '=MIN(3*{d},300)', 'mm', 'cl 26.3.3 b', '0'),
        ('s', 'Main bar spacing', '=MAX(50,INT(MIN(1000*PI()*p_bar^2/4/{Areq},{sMax})/10)*10)', 'mm', 'rounded down to 10 mm', '0'),
        ('Aprov', 'Ast provided', '=1000*PI()*p_bar^2/4/{s}', 'mm²/m', '', '0.0'),
        ('sdMax', 'Max spacing, distribution', '=MIN(5*{d},450)', 'mm', 'cl 26.3.3 b', '0'),
        ('sd', 'Distribution bar spacing', '=INT(MIN(1000*PI()*p_dbar^2/4/{Amin},{sdMax})/10)*10', 'mm', 'for Ast,min', '0'),
        ('Adprov', 'Distribution steel provided', '=1000*PI()*p_dbar^2/4/{sd}', 'mm²/m', '', '0.0'),
        ('pt', 'pt = 100 Ast,prov / b d', '=100*{Aprov}/({b}*{d})', '%', '', '0.0000'),
        ('grade', 'Table 19 grade row', '=IFERROR(LOOKUP(p_fck,t_grade),15)', 'N/mm²', 'highest tabulated grade ≤ fck', '0'),
        ('p', 'pt, clamped 0.15 – 3', '=MIN(MAX({pt},0.15),3)', '%', '', '0.0000'),
        ('i0', 'Table 19 interval', '=COUNTIF(Parameters!$C$18:$M$18,"<"&{p})', '', '', '0'),
        ('tc', 'τc', '=INDEX(t_tc,MATCH({grade},t_grade,0),{i0}+1)+(INDEX(t_tc,MATCH({grade},t_grade,0),{i0}+2)-INDEX(t_tc,MATCH({grade},t_grade,0),{i0}+1))'
               '*({p}-INDEX(t_pt,{i0}+1))/(INDEX(t_pt,{i0}+2)-INDEX(t_pt,{i0}+1))', 'N/mm²', 'Table 19, interpolated', '0.0000'),
        ('k', 'k for slabs', '=MIN(MAX(1.3-({D}-150)/150*0.3,1),1.3)', '', 'cl 40.2.1.1', '0.000'),
        ('tv', 'τv = Vu / b d', '={Vu}*1000/({b}*{d})', 'N/mm²', 'cl 40.1', '0.0000'),
        ('tcmax', 'τc,max', '=INDEX(t_tcmax,MATCH({grade},t_grade,0))', 'N/mm²', 'Table 20', '0.00'),
        ('fs', 'fs = 0.58 fy Ast,req / Ast,prov', '=0.58*p_fy*{Areq}/{Aprov}', 'N/mm²', 'Fig. 4 note', '0.00'),
        ('kt', 'Modification factor kt', '=MIN(2,1/(0.225+0.00322*{fs}+0.625*LOG10({pt})))', '', 'Fig. 4', '0.0000'),
        ('ld', 'L / d provided', '=$B$8*1000/{d}', '', '', '0.00'),
        ('ldAllow', 'L / d allowed = 20 kt', '=20*{kt}', '', 'cl 23.2.1', '0.00'),
        ('thumb', 'Rule-of-thumb waist L/20', '=ROUNDUP($B$8*5,0)*10', 'mm', 'for reference', '0'),
    ]
    refs = {}
    r = 48
    for key, *_ in D:
        refs[key] = f'$B${r}'
        r += 1
    r = 48
    for key, lab, fml, unit, note, fmt in D:
        put(ws, f'A{r}', lab)
        put(ws, f'B{r}', fml.format(**refs), fmt=fmt)
        put(ws, f'C{r}', unit)
        put(ws, f'D{r}', note, dict(font=Font(name=F, size=9, color='666666')))
        r += 1
    title(ws, f'A{r + 1}', 'Checks')
    checks = [
        ('Flexure: Mu ≤ Mu,lim', f'=AND({refs["disc"]}>0,{refs["Mu"]}<={refs["Mlim"]})'),
        ('Shear: τv ≤ k τc', f'={refs["tv"]}<={refs["k"]}*{refs["tc"]}'),
        ('Shear: τv ≤ ½ τc,max', f'={refs["tv"]}<=0.5*{refs["tcmax"]}'),
        ('Deflection: L/d ≤ 20 kt', f'={refs["ld"]}<={refs["ldAllow"]}'),
    ]
    c0 = r + 2
    for i, (lab, fml) in enumerate(checks):
        put(ws, f'A{c0 + i}', lab)
        put(ws, f'B{c0 + i}', f'=IF({fml[1:]},"OK","FAIL")', dict(font=Font(name=F, bold=True)))
    ck = f'$B${c0}:$B${c0 + 3}'
    ws.conditional_formatting.add(ck, FormulaRule(formula=[f'B{c0}="OK"'], fill=OK_FILL))
    ws.conditional_formatting.add(ck, FormulaRule(formula=[f'B{c0}<>"OK"'], fill=BAD_FILL))
    put(ws, f'A{c0 + 5}', 'Main steel', dict(font=Font(name=F, bold=True)))
    put(ws, f'B{c0 + 5}', f'="T"&p_bar&" @ "&{refs["s"]}&" c/c"', dict(font=Font(name=F, bold=True)))
    put(ws, f'A{c0 + 6}', 'Distribution steel', dict(font=Font(name=F, bold=True)))
    put(ws, f'B{c0 + 6}', f'="T"&p_dbar&" @ "&{refs["sd"]}&" c/c"', dict(font=Font(name=F, bold=True)))

    # result banner at the top, deflection failures first, as the app shows them
    put(ws, 'D5', 'Result', dict(font=Font(name=F, bold=True)))
    put(ws, 'E5', f'=IF(COUNTIF({ck},"OK")=4,"ALL CHECKS PASS — "&B{c0 + 5}&", distribution "&B{c0 + 6},'
        f'"FAILS: "&IF(B{c0 + 3}<>"OK","deflection (L/d) ","")&IF(B{c0}<>"OK","flexure ","")&IF(B{c0 + 1}<>"OK","shear ","")&IF(B{c0 + 2}<>"OK","max shear ",""))',
        dict(font=Font(name=F, bold=True)))
    ws.conditional_formatting.add('E5', FormulaRule(formula=['LEFT(E5,3)="ALL"'], fill=OK_FILL))
    ws.conditional_formatting.add('E5', FormulaRule(formula=['LEFT(E5,3)<>"ALL"'], fill=BAD_FILL))
    put(ws, 'D6', 'Mu, Vu', dict(font=Font(name=F, bold=True)))
    put(ws, 'E6', f'=TEXT(D42,"0.00")&" kNm/m at "&TEXT(D44,"0.00")&" m, Vu = "&TEXT(MAX(D40,D41),"0.00")&" kN/m, waist "&{refs["D"]}&" mm"')

    calc_tables(ws)
    charts(ws)
    return ws


# ---------------------------------------------------------------- chart data (far right, columns AA…)
def calc_tables(ws):
    put(ws, 'AA1', 'Drawing data — formulas, do not edit', dict(font=Font(name=F, bold=True, color='808080')))
    header(ws, 2, ['j'] + [f'S{i + 1} {a}' for i in range(NSEG) for a in 'xz'] + ['Beam A x', 'Beam A z', 'Beam B x', 'Beam B z', 'Frame x', 'Frame z'], start=27)
    for j in range(NPTS):
        r = 3 + j
        put(ws, f'AA{r}', j)
        J = f'$AA{r}'
        for i in range(NSEG):
            s = SEG0 + i
            B, C, Dd, E, Ft, Jm, K, Lz, M = (f'${c}${s}' for c in 'BCDEFJKLM')
            close = f'OR({J}=0,{J}>=2*{C}+1)'
            put(ws, f'{CL(28 + 2 * i)}{r}',
                f'=IF({B}="Flight",{Jm}+IF({close},0,IF({J}=2*{C},({C}-1)*{E},INT({J}/2)*{E}))/1000,IF({B}="Landing",IF(OR({J}=1,{J}=2),{K},{Jm}),0))', fmt='0.000')
            put(ws, f'{CL(29 + 2 * i)}{r}',
                f'=IF({B}="Flight",({Lz}+IF({close},-{Ft}*{M},IF({J}={2}*{C},({C}-1)*{Dd}-{Ft}*{M},ROUNDUP({J}/2,0)*{Dd})))/1000,'
                f'IF({B}="Landing",({Lz}-IF(OR({J}=2,{J}=3),0,{Ft}))/1000,$B$7/1000))', fmt='0.000')
        # support at each end: beam rectangle under the slab level, or a triangle when there is no beam
        for e, (cx, cz) in enumerate([('AN', 'AO'), ('AP', 'AQ')]):
            sr = SUP0 + e
            x0 = '0' if e == 0 else '$B$8'
            jj = f'MIN({J},4)'
            put(ws, f'{cx}{r}', f'=IF($B${sr}="Beam",{x0}+IF(OR({jj}=1,{jj}=2),1,-1)*$D${sr}/2000,{x0}+CHOOSE({jj}+1,0,-0.15,0.15,0,0))', fmt='0.000')
            put(ws, f'{cz}{r}', f'=IF($B${sr}="Beam",($F${sr}-IF(OR({jj}=2,{jj}=3),0,$E${sr}))/1000,$F${sr}/1000-CHOOSE({jj}+1,0,0.25,0.25,0,0))', fmt='0.000')
    # invisible frame points so Excel's autoscale keeps the section close to true scale (chart is 2.2 : 1)
    allx, allz = '$AB$3:$AM$64,$AN$3:$AN$64,$AP$3:$AP$64', '$AC$3:$AC$64,$AE$3:$AE$64,$AG$3:$AG$64,$AI$3:$AI$64,$AK$3:$AK$64,$AM$3:$AM$64,$AO$3:$AO$64,$AQ$3:$AQ$64'
    put(ws, 'AR3', '=-0.7')
    put(ws, 'AS3', f'=MIN({allz})-0.15')
    put(ws, 'AR4', f'=AR3+MAX($B$8+1.4,2.2*(MAX({allz})+0.4-AS3))')
    put(ws, 'AS4', f'=AS3+MAX(MAX({allz})+0.4-AS3,($B$8+1.4)/2.2)')

    # sampled statics: x = L·i/500
    header(ws, 2, ['i', 'x (m)', 'DL (kN/m²)', 'LL (kN/m²)', 'V_u (kN/m)', 'M_D', 'M_L', 'M_U (kNm/m)', '−M_U (plot)'], start=53)
    A, B = f'$B${LD0}:$B${LD0 + 7}', f'$C${LD0}:$C${LD0 + 7}'
    for i in range(NX + 1):
        r = 3 + i
        x = f'$BB{r}'
        xe = f'MIN({x},$B$8-1E-9)'  # so the last sample still sits on the loads ending at B
        ov = f'({x}>{A})*(({x}<{B})*({x}-{A})+({x}>={B})*({B}-{A}))'
        put(ws, f'BA{r}', i)
        put(ws, f'BB{r}', f'=$B$8*BA{r}/{NX}', fmt='0.00')
        put(ws, f'BC{r}', f'=SUMPRODUCT(({A}<={xe})*({B}>{xe})*$D${LD0}:$D${LD0 + 7})', fmt='0.000')
        put(ws, f'BD{r}', f'=SUMPRODUCT(({A}<={xe})*({B}>{xe})*$E${LD0}:$E${LD0 + 7})', fmt='0.000')
        put(ws, f'BE{r}', f'=$D$40-SUMPRODUCT($F${LD0}:$F${LD0 + 7}*{ov})', fmt='0.000')
        for col, rc, w in [('BF', 'B', 'D'), ('BG', 'C', 'E'), ('BH', 'D', 'F')]:
            put(ws, f'{col}{r}', f'=${rc}$40*{x}-SUMPRODUCT(${w}${LD0}:${w}${LD0 + 7}*{ov}*({x}-{A}-{ov}/2))', fmt='0.000')
        put(ws, f'BI{r}', f'=-BH{r}', fmt='0.000')


def line(series, color, width=1.25, none=False):
    series.marker.symbol = 'none'
    series.smooth = False
    series.graphicalProperties = GraphicalProperties()
    series.graphicalProperties.line = LineProperties(noFill=True) if none else LineProperties(solidFill=color, w=int(width * 12700))


def tidy(ch):
    # title above the plot, axis numbers along the bottom edge rather than on the zero line
    ch.title.overlay = False
    ch.x_axis.tickLblPos = 'low'
    ch.y_axis.tickLblPos = 'low'


def charts(ws):
    last = 3 + NPTS - 1
    sc = ScatterChart()
    sc.title = 'Section along the strip (m) — A at left, B at right'
    sc.style = 13
    sc.x_axis.title = 'distance from A (m)'
    sc.y_axis.title = 'level (m)'
    sc.legend = None
    sc.height, sc.width = 10, 22
    colors = ['1F4E79', 'C00000', '1F4E79', 'C00000', '1F4E79', 'C00000']
    for i in range(NSEG):
        s = Series(Reference(ws, min_col=29 + 2 * i, min_row=3, max_row=last), Reference(ws, min_col=28 + 2 * i, min_row=3, max_row=last))
        line(s, colors[i], 1.5)
        sc.series.append(s)
    for cx in (40, 42):
        s = Series(Reference(ws, min_col=cx + 1, min_row=3, max_row=7), Reference(ws, min_col=cx, min_row=3, max_row=7))
        line(s, '000000', 2.25)
        sc.series.append(s)
    s = Series(Reference(ws, min_col=45, min_row=3, max_row=4), Reference(ws, min_col=44, min_row=3, max_row=4))
    line(s, None, none=True)
    sc.series.append(s)
    sc.x_axis.number_format = '0.0'
    sc.y_axis.number_format = '0.0'
    sc.x_axis.delete = sc.y_axis.delete = False
    tidy(sc)
    ws.add_chart(sc, 'W2')

    xs = Reference(ws, min_col=54, min_row=3, max_row=3 + NX)

    def area(title_, cols, colors_, ytitle, stacked=False, fmt='0.0'):
        ch = AreaChart()
        ch.title = title_
        ch.grouping = 'stacked' if stacked else 'standard'
        if stacked:
            ch.overlap = 100
        ch.height, ch.width = 7.5, 22
        for c, col in zip(cols, colors_):
            ch.add_data(Reference(ws, min_col=c, min_row=2, max_row=3 + NX), titles_from_data=True)
            ch.series[-1].graphicalProperties = GraphicalProperties(solidFill=col)
            ch.series[-1].graphicalProperties.line = LineProperties(solidFill='000000', w=9525)
        ch.set_categories(xs)
        ch.x_axis.title = 'x from A (m)'
        ch.y_axis.title = ytitle
        ch.x_axis.tickLblSkip = ch.x_axis.tickMarkSkip = NX // 10
        ch.x_axis.number_format = '0.00'
        ch.y_axis.number_format = fmt
        ch.x_axis.delete = ch.y_axis.delete = False
        ch.legend.position = 'b'
        if len(cols) == 1:
            ch.legend = None
        else:
            ch.legend.position = 'r'
        tidy(ch)
        return ch

    ws.add_chart(area('(a) Unfactored loading per m width — Dead + Live (kN/m²)', [55, 56], ['A6A6A6', 'BDD7EE'], 'kN/m²', stacked=True), 'W23')
    ws.add_chart(area('(b) Shear force, factored (kN/m)', [57], ['FCE4D6'], 'kN/m'), 'W39')
    # moment plotted negative so it hangs on the tension side; the format drops the sign
    ws.add_chart(area('(c) Bending moment, factored — tension side (kNm/m)', [61], ['F8CBAD'], 'kNm/m', fmt='0.0;0.0'), 'W55')


# ---------------------------------------------------------------- example: quarter-turn stair, S1 rests on S2 (app template 'L' without the beam past the landing)
def main(out):
    wb = Workbook()
    parameters(wb)
    span_sheet(wb, 'S1', dict(name='S1', width=1200, zA=0,
                              segs=[dict(name='F1', type='Flight', n=10, R=150, T=300, t=200, k=1), dict(name='L1', type='Landing', t=200, len=0.6, k=0.5)],
                              tr=[], sup=[dict(type='Beam', name='B1', bw=300, bd=500), dict(type='Rests on span', name='S2')]))
    span_sheet(wb, 'S2', dict(name='S2', width=1200, zA=1500,
                              segs=[dict(name='L1', type='Landing', t=200, len=1.2, k=0.5), dict(name='F2', type='Flight', n=10, R=150, T=300, t=200, k=1)],
                              tr=[dict({'from': '=S1!B5'}, RD='=S1!B41', RL='=S1!C41', w='=S1!B6', at=0.6, ang=90)],
                              sup=[dict(type='Beam', name='B2', bw=300, bd=500), dict(type='Beam', name='B3', bw=300, bd=500)]))
    wb.save(out)


if __name__ == '__main__':
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else 'Stair Design.xlsx')
