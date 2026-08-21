(function(){
  function clean(){
    document.querySelectorAll('a.tile[data-work-id]').forEach(function(a){
      a.href='/' + encodeURIComponent(a.dataset.workId) + '/';
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',clean);else clean();
})();
