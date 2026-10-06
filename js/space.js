(function(root){
  'use strict';
  const Space=root.PSASpace={version:'1.0',depths:[0,5.5,13.5,22]};
  Space.crop=function(g,c0,r0,width,height){
    const band=new Uint8Array(width*height);
    for(let r=0;r<height;r++)for(let c=0;c<width;c++)band[r*width+c]=g.band[(r+r0)*g.cols+c+c0];
    return {cols:width,rows:height,band,pitch:g.pitch,px:0,py:0,w:width*g.pitch,h:height*g.pitch};
  };
  Space.windows=function(g,width,height){
    const w=Math.max(1,Math.min(g.cols,Math.round(width))),h=Math.max(1,Math.min(g.rows,Math.round(height)));
    const positions=(end,step)=>{const a=[];for(let i=0;i<=end;i+=step)a.push(i);if(a.at(-1)!==end)a.push(end);return a;};
    let step=3,xs,ys;
    do{xs=positions(g.cols-w,step);ys=positions(g.rows-h,step);if(xs.length*ys.length<=180)break;step+=3;}while(true);
    return {width:w,height:h,step,windows:ys.flatMap(r=>xs.map(c=>({c,r,w,h})))};
  };
  Space.assess=function(g,window,objective){
    const grid=Space.crop(g,window.c,window.r,window.w,window.h),result=root.PSA.analyze(grid);
    if(result.features.empty)return null;
    const words=objective==='balanced'?root.PSA.WORDS:[objective];
    if(words.some(w=>!root.PSARubric.definitions[w]))throw Error('Unknown spatial objective');
    const scores=words.map(word=>({word,...root.PSARubric.summarize(result.ratings[word],root.PSARubric.generate(result,word))}));
    const score=scores.reduce((sum,s)=>sum+s.combined,0)/scores.length;
    return {...window,score,scores,grid};
  };
  // Each cell is a surface at an estimated depth, extruded by a user-declared thickness.
  // No geometry behind the extrusion is claimed to have been recovered.
  Space.boxes=function(g,thickness){
    const boxes=[];
    for(let r=0;r<g.rows;r++)for(let c=0;c<g.cols;){
      const band=g.band[r*g.cols+c];if(band===4){c++;continue;}
      let end=c+1;while(end<g.cols&&g.band[r*g.cols+end]===band)end++;
      boxes.push({x0:c,x1:end,y0:r,y1:r+1,z0:Space.depths[band],z1:Space.depths[band]+thickness,band});c=end;
    }
    return boxes;
  };
  Space.section=function(g,column,thickness){
    const c=Math.max(0,Math.min(g.cols-1,Math.round(column))),out=[];
    for(let r=0;r<g.rows;r++){const b=g.band[r*g.cols+c];if(b<4)out.push({y:r,depth:Space.depths[b],thickness,band:b});}
    return out;
  };
  Space.svg=function(g,column,thickness,title){
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    const depth=22+thickness,W=1000,H=600,pad=80,scale=Math.min((W-2*pad)/depth,(H-200)/g.rows),bottom=H-110;
    const X=z=>pad+z*scale,Y=y=>bottom-y*scale;
    let body=`<rect width="1000" height="600" fill="#fff"/><g font-family="Arial,sans-serif" fill="#222222"><text x="40" y="35" font-size="20" font-weight="bold">SECTION A–A · INFERRED MODEL</text><text x="40" y="60" font-size="13">${esc(title)}</text><text x="40" y="81" font-size="12">Cut at x = ${(column+.5).toFixed(1)} m from selected area's left edge · slab thickness assumption: ${thickness} m</text>`;
    for(let y=0;y<=g.rows;y+=3)body+=`<line x1="${pad-8}" x2="${X(depth)+10}" y1="${Y(y)}" y2="${Y(y)}" stroke="#c5c5c5" stroke-dasharray="5 5"/><text x="${pad-14}" y="${Y(y)+4}" font-size="11" text-anchor="end">+${y} m</text>`;
    for(const cell of Space.section(g,column,thickness))body+=`<rect x="${X(cell.depth)}" y="${Y(cell.y+1)}" width="${thickness*scale}" height="${scale}" fill="#222222" stroke="#fff" stroke-width=".35"/>`;
    body+=`<line x1="${pad}" x2="${X(depth)}" y1="${bottom+18}" y2="${bottom+18}" stroke="#222222"/>`;
    for(let z=0;z<=depth;z+=5)body+=`<line x1="${X(z)}" x2="${X(z)}" y1="${bottom+13}" y2="${bottom+23}" stroke="#222222"/><text x="${X(z)}" y="${bottom+39}" font-size="11" text-anchor="middle">${z} m</text>`;
    body+=`<text x="${pad}" y="${bottom+60}" font-size="12">FRONT → DEPTH · black = modeled solid; blank = unmodeled space, not verified room volume</text><text x="40" y="581" font-size="11">Tone-derived depths: 0 / 5.5 / 13.5 / 22 m. Dashed datums every 3 m are reference levels, not detected floors.</text></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600" role="img" aria-label="Inferred section drawing">${body}</svg>`;
  };
})(typeof window!=='undefined'?window:globalThis);
