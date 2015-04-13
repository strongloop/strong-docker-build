exports.success = success;

function success(result) {
  return onSuccess;

  function onSuccess(next) {
    next(null, result);
  }
}
