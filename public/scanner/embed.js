if (new URLSearchParams(location.search).get('embed') === '1' && parent !== window) {
  document.documentElement.classList.add('embedded');
}
