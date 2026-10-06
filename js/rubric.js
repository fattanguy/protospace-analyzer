(function (root) {
  'use strict';
  const definitions = {
    'Modular': {
      weights: [65,35,0],
      intent: 'Repeated units form a readable system while allowing useful variation.',
      limit: 'The fitted 9 × 3 m face grid measures visual repetition; it does not establish construction modules or structural feasibility.',
      questions: [
        ['Unit legibility', 'Units are difficult to distinguish from one continuous mass.', 'Repeated units and their boundaries remain clear across the selected region.'],
        ['Coherent variation', 'Changes in size or placement obscure the underlying system.', 'Variation creates useful differences while preserving a clear shared module.']]
    },
    'Fragmented': {
      weights: [50,50],
      intent: 'The form reads as distinct pieces or territories rather than one continuous body.',
      limit: 'Separation is measured in the visible face. Pieces that appear separate can be connected behind it; more fragmentation is not automatically better.',
      questions: [
        ['Distinct parts', 'The form reads as one undifferentiated body.', 'Several distinct parts have clear edges, gaps and individual identities.'],
        ['Intentional composition', 'The separation appears accidental or leaves isolated remnants.', 'The separated parts form an intentional composition with understandable relationships.']]
    },
    'Interlocking': {
      weights: [25,50,25],
      intent: 'Parts overlap, offset and engage across levels or depth.',
      limit: 'Contact and tonal depth changes are visual proxies. They do not confirm physical joints, accessible connections or load transfer.',
      questions: [
        ['Mutual engagement', 'Parts merely touch or stack with no clear overlap.', 'Parts visibly overlap, nest or offset in ways that engage adjacent units.'],
        ['Three-dimensional reading', 'The overlap can only be inferred from an ambiguous silhouette.', 'Engagement reads clearly across levels and depth, supported by another view when needed.']]
    },
    'Porous': {
      weights: [60,40],
      intent: 'A coherent body contains distributed openings and substantial recesses.',
      limit: 'Light pixels and recesses do not prove airflow, daylight performance or traversable passages. The 50–66% target is a project preference.',
      questions: [
        ['Distribution of openings', 'The body is closed or openness is concentrated in one isolated gap.', 'Openings are distributed through the body and connect several spatial situations.'],
        ['Spatial quality of voids', 'Gaps read as leftover cuts with little relation to adjacent spaces.', 'Voids have clear edges, depth and a deliberate relationship to surrounding spaces.']]
    },
    'Clustered': {
      weights: [25,30,45],
      intent: 'Units form identifiable groups with readable boundaries and shared relationships.',
      limit: 'Connected face modules are only a grouping proxy; shared ownership, program or access needs plan evidence.',
      questions: [
        ['Group identity', 'Units read as either scattered individuals or one continuous block.', 'Several groups can be identified, each with a coherent internal relationship.'],
        ['Shared focus', 'Groups lack an identifiable shared place or organizing element.', 'Each group relates to a discernible shared place, threshold or organizing element.']]
    },
    'Decentralized': {
      weights: [45,30,25],
      intent: 'Potential shared spaces are distributed near multiple territories and levels.',
      limit: 'Distances are straight-line image estimates, not walking distances. Recesses are candidate gathering spaces, not verified amenities.',
      questions: [
        ['Multiple centers', 'One dominant center serves the composition while other areas appear underserved.', 'Several meaningful centers serve distinct parts of the composition.'],
        ['Equitable access', 'Important territories appear remote from shared spaces or depend on a single route.', 'Plans or visible routes support comparable access to shared spaces across territories.']]
    },
    'Networked': {
      weights: [60,40],
      intent: 'A connected spatial system offers several potential links and route choices.',
      limit: 'Adjacency is not a doorway or route. Accessibility, dead ends and alternate paths require a circulation plan or model.',
      questions: [
        ['Route continuity', 'Links appear interrupted or fail to connect important destinations.', 'Evidence shows continuous routes connecting the principal destinations.'],
        ['Meaningful choices', 'Movement depends on a single path or apparent links do not lead anywhere.', 'Evidence shows useful alternative routes with understandable destinations.']]
    },
    'Layered': {
      weights: [55,45],
      intent: 'Different spatial conditions overlap vertically and around occupied units.',
      limit: 'The image classifies mass, recesses and openings. These are spatial types, not confirmed activities or program functions.',
      questions: [
        ['Legible depth and levels', 'Spaces read as a single flat layer or as disconnected stacks.', 'Several layers and their relationships remain legible across depth and levels.'],
        ['Productive overlap', 'Layers overlap without a clear spatial or programmatic purpose.', 'Sections or program evidence show how overlapping layers support distinct but related uses.']]
    },
    'Intimate': {
      weights: [40,60],
      intent: 'Territories offer small-group scale, enclosure and a sense of personal proximity.',
      limit: 'Area assumes 9 m depth and occupancy assumes 10 m² per person. Actual occupancy, acoustics and comfort are not measured.',
      questions: [
        ['Human scale and enclosure', 'Spaces feel exposed, oversized or too constrained for the intended group.', 'Dimensions, edges and reference objects support comfortable small-group enclosure.'],
        ['Privacy and belonging', 'Territories lack thresholds or a readable distinction between shared and personal space.', 'Thresholds and spatial boundaries support privacy, belonging and optional contact.']]
    },
    'Visually Connected': {
      weights: [45,30,25],
      intent: 'Territories offer potential views toward other territories and levels.',
      limit: 'Two-dimensional rays ignore eye height, glazing, occlusion in depth and privacy. Confirm sightlines in sections or a 3D model.',
      questions: [
        ['Useful visual relationships', 'Views are blocked, incidental or aimed at blank surfaces.', 'Evidence shows meaningful views toward occupied places and shared activities.'],
        ['Connection with privacy', 'Visual exposure is intrusive or connections are too restricted to be useful.', 'Views support awareness of others while allowing retreat and control over exposure.']]
    },
    'Socially Interactive': {
      weights: [60,40],
      intent: 'Circulation and potential shared spaces create opportunities for optional encounters.',
      limit: 'This is a score for spatial opportunity. Actual interaction needs observation or user evidence; seating, access and programming cannot be inferred from a recess.',
      questions: [
        ['Reasons to stay', 'Shared spaces are only passing areas with no evidence of usable places to linger.', 'Evidence shows usable shared places with seating, activities or other reasons to stay.'],
        ['Optional encounters', 'Movement either bypasses shared places or forces intrusive contact.', 'Routes meet shared places naturally while preserving choice and comfortable passing space.']]
    },
    'Village-Like': {
      weights: [35,30,35],
      intent: 'Distinct groups, connecting routes and shared centers form a readable neighborhood structure.',
      limit: 'Counts do not establish a community. Identity, stewardship, mixed uses and social relationships require qualitative evidence.',
      questions: [
        ['Neighborhood identity', 'Parts lack distinct identities or form unrelated fragments.', 'Distinct groups have recognizable identities within a coherent larger whole.'],
        ['Public-to-private sequence', 'Routes and shared places lack a clear hierarchy or transitions.', 'Evidence shows a legible sequence from shared routes and centers to smaller territories.']]
    }
  };
  const R = root.PSARubric = {
    version: '2.0', definitions,
    label(score) { return score == null ? 'Not assessable' : score < 20 ? 'Very limited fit' : score < 40 ? 'Limited fit' : score < 60 ? 'Moderate fit' : score < 80 ? 'Strong fit' : 'Very strong fit'; },
    summarize(quantitative, review) {
      const complete = !!review && review.values.length === 2 && review.values.every(v => Number.isInteger(v) && v >= 0 && v <= 4) && !!review.evidence.trim();
      const qualitative = complete ? review.values.reduce((a,b) => a+b,0) / 8 * 100 : null;
      return { quantitative, qualitative, combined: quantitative != null && qualitative != null ? Math.round(.7 * quantitative + .3 * qualitative) : null };
    },
    apply(result) {
      result.legacyRatings = {...result.ratings};
      for (const [word, definition] of Object.entries(definitions)) {
        const ex = result.explain[word];
        if (result.features.empty) { result.ratings[word] = null; ex.terms = []; continue; }
        if (word === 'Fragmented') {
          ex.terms[1] = {name:'Mass outside the largest body', value:Math.round(100*(1-result.measures.cohesion))+'%', note:'0% when all face mass is connected; increases as mass separates into other bodies.', norm:1-result.measures.cohesion};
          ex.advice = 'Use the qualitative review to decide whether the separation is intentional and appropriate for the design.';
        }
        const normalization = {
          'Modular':['Normalized as the measured share.','Normalized as the share of module cells at least 70% full or at most 30% full.'],
          'Fragmented':['Linear from 0 at no territories to 1 at 5 territories, capped at 1.','Normalized as one minus the largest-body share.'],
          'Interlocking':['Linear from 0 to 21 contacts, capped at 1.','Linear from 0 to 9 interlocking contacts, capped at 1.','1 − |horizontal − vertical| / total; 0 if there are no contacts.'],
          'Porous':['0 at or below 15%; linear rise to 1 at 50%; 1 through 66%; linear fall to 0 at 90% and above.','Linear from 0 to 2 openings, capped at 1.'],
          'Clustered':['0 at 0 clusters; linear rise to 1 at 2; 1 through 6; linear fall to 0 at 14.','0 at 1 module or fewer; linear rise to 1 at 3; 1 through 10; linear fall to 0 at 20.','Normalized as the occupied-module share.'],
          'Decentralized':['1 at 2.4 m or less; linear fall to 0 at 6.1 m; 0 if no pocket exists.','Square root of min(1, pocket count / 5).','Square root of the fraction of floors with a pocket.'],
          'Networked':['Linear from 0 to 3.6 potential links per module, capped at 1.','Normalized as the occupied-module share.'],
          'Layered':['Linear from 0 to 4 spatial types per module, capped at 1.','Normalized as the image-column share.'],
          'Intimate':['0 at 0 estimated people; linear rise to 1 at 4; 1 through 12; linear fall to 0 at 40.','Normalized as the estimated-area share.'],
          'Visually Connected':['Normalized as the occupied-module share.','Normalized as the occupied-module share.','Linear from 0 to 1.6 view targets per module, capped at 1.'],
          'Socially Interactive':['Linear from 0 to 3 street–pocket pairs, capped at 1.','Normalized as the inferred street-length share.'],
          'Village-Like':['Linear from 0 to 3 clusters, capped at 1.','Linear from 0 to 3 streets, capped at 1.','Linear from 0 to 5 pockets, capped at 1.']
        };
        ex.terms = ex.terms.map((term,i) => ({...term, weight:definition.weights[i], note:term.note + ' Normalization: ' + (normalization[word][i] || '')})).filter(term=>term.weight>0);
        const total = ex.terms.reduce((n,t)=>n + t.weight * t.norm,0);
        result.ratings[word] = Math.round(total);
        ex.terms.forEach(t=>t.contribution = t.weight*t.norm);
      }
      return result;
    }
  };
  if (root.PSA) {
    const analyze = root.PSA.analyze;
    root.PSA.analyze = grid => R.apply(analyze(grid));
  }
})(typeof window !== 'undefined' ? window : globalThis);

(function(root){
  const R=root.PSARubric;
  // Interpret visible spatial patterns. These rules do not infer behavior, intent or unseen rooms.
  const profiles={
    'Modular':[
      ['Readable units',[0],'mean','Mass is mostly outside complete units.','Most mass belongs to complete repeated units.'],
      ['Clear assembly',[0,1],'min','Ambiguous or incomplete cells blur the assembly.','Unit completeness and full/empty clarity support a legible assembly.']],
    'Fragmented':[
      ['Distinct pieces',[0],'mean','Few distinct pieces are visible.','Several distinct pieces are visible.'],
      ['Distributed separation',[0,1],'min','One body dominates or few pieces separate from it.','Several pieces account for a substantial share of the visible mass.']],
    'Interlocking':[
      ['Visible engagement',[0,1],'min','Contacts rarely show offset or depth engagement.','Contacts include repeated offset or depth engagement.'],
      ['Engagement across directions',[1,2],'min','Engagement is limited or concentrated in one direction.','Interlocking cues occur with both horizontal and vertical relationships.']],
    'Porous':[
      ['Open yet coherent body',[0],'mean','The void-to-mass balance is outside the project target.','The void-to-mass balance supports an open yet coherent body.'],
      ['Pierced mass',[0,1],'min','The mass shows few enclosed through-openings or lacks surrounding mass.','Through-openings and the void balance together support a pierced spatial reading.']],
    'Clustered':[
      ['Readable groups',[0,1],'min','Group count or size makes distinct clusters difficult to read.','Several groups of moderate size support a clear cluster reading.'],
      ['Membership in groups',[2],'mean','Many units fall outside the target group sizes.','Most units belong to groups of three to ten modules.']],
    'Decentralized':[
      ['Nearby shared-space potential',[0,1],'min','Few candidate pockets or long estimated distances limit distributed centers.','Several nearby candidate pockets support distributed centers.'],
      ['Centers across levels',[1,2],'min','Candidate centers are few or concentrated on limited levels.','Multiple candidate centers are spread across levels.']],
    'Networked':[
      ['Linked spatial fabric',[0],'mean','Few geometric links connect the visible modules.','Repeated geometric links suggest a connected spatial fabric.'],
      ['Choice of connections',[0,1],'min','Many modules have few alternative geometric links.','Many modules have several potential connections.']],
    'Layered':[
      ['Local spatial variety',[0],'mean','Few spatial types occur around each module.','Several spatial types occur around each module.'],
      ['Vertical overlap',[0,1],'min','Spatial variety is limited or does not recur vertically.','Local variety and vertical mixing support a layered reading.']],
    'Intimate':[
      ['Small-group scale',[0],'mean','Estimated territory capacity falls outside the small-group target.','Estimated territory capacity fits the small-group target.'],
      ['Consistent territory scale',[0,1],'min','Capacity or area estimates give limited support for intimate scale.','Capacity and territory-area estimates consistently support intimate scale.']],
    'Visually Connected':[
      ['Visual relationships',[0,2],'min','Few modules have repeated potential view targets.','Many modules have repeated potential view targets.'],
      ['Views across levels',[0,1],'min','Potential views are scarce or limited to one direction.','Potential views link both territories and levels.']],
    'Socially Interactive':[
      ['Encounter opportunities',[0],'mean','Few inferred street–pocket contacts offer encounter opportunities.','Repeated inferred street–pocket contacts offer encounter opportunities.'],
      ['Shared space along routes',[0,1],'min','Candidate shared spaces have limited contact with inferred routes.','Candidate shared spaces repeatedly meet and lie near inferred routes.']],
    'Village-Like':[
      ['Neighborhood ingredients',[0,1,2],'min','One or more ingredients—groups, routes or shared centers—are weak.','Groups, routes and candidate shared centers are all present at the project targets.'],
      ['Groups connected by shared space',[0,1,2],'geometric','An uneven mix of groups, routes and centers limits the neighborhood reading.','A balanced mix of groups, routes and centers supports a neighborhood reading.']]
  };
  R.version='3.0';
  R.automaticProfiles=profiles;
  Object.entries(profiles).forEach(([word,axes])=>{R.definitions[word].questions=axes.map(a=>[a[0],a[3],a[4]]);});
  R.generate=function(result,word){
    if(result.features.empty || result.ratings[word]==null) return {values:[null,null],evidence:'Insufficient visible mass for an image-based interpretation. Check the frame, crop, tone and scale.',source:'automatic',rules:[]};
    const terms=result.explain[word].terms;
    const rules=profiles[word].map(([name,indices,operation,low,high])=>{
      const metrics=indices.map(i=>terms[i]);
      const values=metrics.map(t=>Math.max(0,Math.min(1,t.norm)));
      const strength=operation==='min'?Math.min(...values):operation==='geometric'?Math.pow(values.reduce((a,b)=>a*b,1),1/values.length):values.reduce((a,b)=>a+b,0)/values.length;
      const judgment=Math.min(4,Math.floor((strength+1e-10)*5));
      const reading=judgment<=1?low:judgment>=3?high:'Mixed evidence: '+low+' Some measured features support the stronger reading.';
      return {name,judgment,strength,operation,metrics:metrics.map(t=>({name:t.name,value:t.value,normalized:t.norm})),reading};
    });
    return {values:rules.map(r=>r.judgment),source:'automatic',rules,evidence:rules.map(r=>r.name+' — '+r.judgment+'/4. '+r.reading+' Evidence: '+r.metrics.map(t=>t.name+': '+t.value).join('; ')+'.').join('\n\n')+'\n\nLimit: '+R.definitions[word].limit};
  };
})(typeof window!=='undefined'?window:globalThis);
