//////////////////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2019, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////////////////

function setFocusToProfilerEditor(editor, command) {
  const TAB = 9;
  if (!command)
    return;
  let key = command.which || command.keyCode;
  // Keys other than Tab key
  if (key !== TAB) {
    editor.focus();
  }
}

function getFunctionId(treeInfoObject) {
  let objectId;
  if(treeInfoObject) {
    if (treeInfoObject.function && treeInfoObject.function._id) {
      objectId = treeInfoObject.function._id;
    } else if (treeInfoObject.edbfunc && treeInfoObject.edbfunc._id) {
      objectId = treeInfoObject.edbfunc._id;
    }
  }
  return objectId;
}

function getProcedureId(treeInfoObject) {
  let objectId;
  if(treeInfoObject) {
    if (treeInfoObject.procedure && treeInfoObject.procedure._id) {
      objectId = treeInfoObject.procedure._id;
    } else if (treeInfoObject.edbproc && treeInfoObject.edbproc._id) {
      objectId = treeInfoObject.edbproc._id;
    }
  }
  return objectId;
}

module.exports = {
  setFocusToProfilerEditor: setFocusToProfilerEditor,
  getFunctionId: getFunctionId,
  getProcedureId: getProcedureId,
};
