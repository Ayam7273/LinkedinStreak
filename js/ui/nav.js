// Landing-page navbar: clear at the top, translucent once the page scrolls under it.
const nav = document.querySelector('.l-nav');

if (nav) {
  let ticking = false;
  const update = () => {
    nav.classList.toggle('is-scrolled', window.scrollY > 0);
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}
