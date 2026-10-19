/* Typefall word bank: short, common English words. */
window.WordBank = (() => {
  const LIST = (
    'the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is was are had were said did made find long down very great still own last high small large next early young few public bad same able learn change move live point world home play light hand turn start show part place keep house should help talk city water far run game story fact month lot right study book eye job word side kind head stand page school night power line end tree open seem plant cover food sun four state never paper group mind music color river star sea leave hold plan close sure walk white begin road smile soon both mark often while along might under name dear sing ask fly late feel watch thing face late warm glad clear sleep green blue gold quick happy laugh stone train apple ocean planet dance smart brave quiet rain cloud dream space lucky magic sugar storm candy gravity letter fall jump float spark spin bounce'
  ).split(/\s+/);
  function generate(n) {
    const out = [];
    while (out.length < n) {
      const w = LIST[(Math.random() * LIST.length) | 0];
      if (w !== out[out.length - 1]) out.push(w);
    }
    return out;
  }
  return { generate };
})();
