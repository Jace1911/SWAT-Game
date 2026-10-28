#!/bin/sh
# 1) concatenate core modules (rules only, no DOM) into src/core.js
# 2) inline core/render/career(persistence)/ui into one self-contained index.html
cd "$(dirname "$0")"
cat src/core_parts/a_base.js src/core_parts/b_house.js src/core_parts/c1_furn.js src/core_parts/c2_world.js src/core_parts/c3_cover.js src/core_parts/d_units.js src/core_parts/d1_inventory.js src/core_parts/d2_overwatch.js src/core_parts/d3_gas.js src/core_parts/d4_breach.js src/core_parts/d5_casualty.js src/core_parts/d6_nego.js src/core_parts/d7_scene.js src/core_parts/d8_progress.js \
    src/core_parts/e_orders.js src/core_parts/f1_cmds.js src/core_parts/f2_turn.js src/core_parts/f3_combat.js src/core_parts/f4_end.js src/core_parts/g_end.js > src/core.js
python3 - <<'PY'
s=open('src/shell.html').read()
for k,f in (('CORE','core.js'),('RENDER','render.js'),('CAREER','career.js'),('UI','ui.js')):
    s=s.replace('/*__%s__*/'%k, open('src/'+f).read())
open('index.html','w').write(s)
print('built index.html', len(s))
PY
