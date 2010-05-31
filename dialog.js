/* Dialog -- a Javascript load/save library for IF interfaces
 * Designed by Andrew Plotkin <erkyrath@eblong.com>
 * <http://eblong.com/zarf/glk/glkote.html>
 * 
 * This Javascript library is copyright 2010 by Andrew Plotkin. You may
 * copy and distribute it freely, by any means and under any conditions,
 * as long as the code and documentation is not changed. You may also
 * incorporate this code into your own program and distribute that, or
 * modify this code and use and distribute the modified version, as long
 * as you retain a notice in your program or documentation which mentions
 * my name and the URL shown above.
 *
 * This library lets you open a modal dialog box to select a "file" for saving
 * or loading data. The web page must have a <div> with id "windowport" (this
 * will be greyed out during the selection process, with the dialog box as a
 * child of the div). It should also have the dialog.css stylesheet loaded.
 *
 * This library also contains utility routines to manage "files", which are
 * actually entries in the browser's localStorage object.
 *
 *
 * Dialog.open(tosave, usage, gameid, callback) -- open a file-choosing dialog
 *
 * The "tosave" flag should be true for a save dialog, false for a load
 * dialog.
 *
 * The "usage" and "gameid" arguments are arbitrary strings which describe the
 * file. These filter the list of files displayed; the dialog will only list
 * files that match the arguments. Pass null to either argument (or both) to
 * skip filtering.
 *
 * The "callback" should be a function. This will be called with a fileref
 * argument (see below) when the user selects a file. If the user cancels the
 * selection, the callback will be called with a null argument.
 *
 *
 * The rest of the API concerns file reference objects. A fileref encodes a
 * usage and gameid (as above), along with a filename (which can be any string
 * at all). This trio specifies a "file", that is, a chunk of data in browser
 * local storage.
 *
 * (These fileref objects are not the same as the filerefs used in the Glk API.
 * A Glk fileref contains one of these filerefs, however.)
 *
 * Dialog.file_construct_ref(filename, usage, gameid) -- create a fileref
 *
 * Create a fileref. This does not create a file; it's just a thing you can use
 * to read an existing file or create a new one. Any unspecified arguments are
 * assumed to be the empty string.
 *
 * Dialog.file_write(ref, content, israw) -- write data to the file
 *
 * The "content" argument is stored to the file. If "israw" is true, the
 * content must be a string. Otherwise, the content is converted to JSON (using
 * JSON.stringify) before being stored.
 *
 * HTML's localStorage mechanism has no incremental storage API; you have to
 * store the entire chunk of data at once. Therefore, the given content
 * replaces the existing contents of the file (if any).
 *
 * Dialog.file_read(ref, israw) -- read data from the file
 *
 * Read the (entire) content of the file. If "israw" is true, this returns the
 * string that was stored. Otherwise, the content is converted from JSON (using
 * JSON.parse) before being returned.
 *
 * Dialog.file_ref_exists(ref) -- returns whether the file exists
 *
 * Dialog.file_remove_ref(ref) -- delete the file, if it exists
 */

Dialog = function() {

var root_el_id = 'windowport';
var dialog_el_id = 'dialog';

var is_open = false;
var dialog_callback = null;
var will_save; /* is this a save dialog? */
var confirming; /* are we in a "confirm" sub-dialog? */
var cur_usage; /* a string representing the file's category */
var cur_gameid; /* a string representing the game */
var cur_filelist; /* the files currently on display */

function dialog_open(tosave, usage, gameid, callback) {
    if (is_open)
        throw 'Dialog: dialog box is already open.';

    if (!window.localStorage)
        throw 'Dialog: your browser does not support local storage.';

    dialog_callback = callback;
    will_save = tosave;
    confirming = false;
    cur_usage = usage;
    cur_gameid = gameid;

    var rootel = $(root_el_id);
    if (!rootel)
        throw 'Dialog: unable to find root element #' + root_el_id + '.';

    var screen = $(dialog_el_id+'_screen');
    if (!screen) {
        screen = new Element('div',
            { id: dialog_el_id+'_screen' });
        rootel.insert(screen);
    }

    var dia = $(dialog_el_id);
    if (dia)
        dia.remove();

    dia = new Element('div', { id: dialog_el_id });
    //### center better?
    var styledic = { left: 150+'px', top: 150+'px' };
    dia.setStyle(styledic);

    var form, el, row;

    form = new Element('form');
    if (will_save)
        form.onsubmit = evhan_accept_save_button;
    else
        form.onsubmit = evhan_accept_load_button;
    dia.insert(form);

    row = new Element('div', { id: dialog_el_id+'_cap', 'class': 'DiaCaption' });
    insert_text(row, 'XXX');
    form.insert(row);

    if (will_save) {
        row = new Element('div', { id: dialog_el_id+'_input', 'class': 'DiaInput' });
        form.insert(row);
        el = new Element('input', { id: dialog_el_id+'_infield', type: 'text', name: 'filename' });
        row.insert(el);
    }

    row = new Element('div', { id: dialog_el_id+'_body', 'class': 'DiaBody' });
    form.insert(row);

    row = new Element('div', { id: dialog_el_id+'_cap2', 'class': 'DiaCaption' });
    row.hide();
    form.insert(row);

    row = new Element('div', { 'class': 'DiaButtons' });
    el = new Element('button', { id: dialog_el_id+'_cancel', type: 'button' });
    insert_text(el, 'Cancel');
    el.onclick = evhan_cancel_button;
    row.insert(el);
    el = new Element('button', { id: dialog_el_id+'_accept', type: 'submit' });
    insert_text(el, (will_save ? 'Save' : 'Load'));
    row.insert(el);
    form.insert(row);

    rootel.insert(dia);
    is_open = true;

    evhan_storage_changed();
}

function dialog_close() {
    var dia = $(dialog_el_id);
    if (dia)
        dia.remove();
    var screen = $(dialog_el_id+'_screen');
    if (screen)
        screen.remove();

    is_open = false;
    dialog_callback = null;
    cur_filelist = null;
}

function set_caption(msg, isupper) {
    var elid = (isupper ? dialog_el_id+'_cap' : dialog_el_id+'_cap2');
    var el = $(elid);
    if (!el)
        return;

    if (!msg) {
        el.hide();
    }
    else {
        remove_children(el);
        insert_text(el, msg);
        el.show();
    }
}

function insert_text(el, val) {
    var nod = document.createTextNode(val);
    el.appendChild(nod);
}

function remove_children(parent) {
    var obj, ls;
    ls = parent.childNodes;
    while (ls.length > 0) {
        obj = ls.item(0);
        parent.removeChild(obj);
    }
}

function replace_text(el, val) {
    remove_children(el);
    insert_text(el, val);
}

function evhan_select_change() {
    if (!is_open)
        return false;
    if (confirming)
        return false;

    GlkOte.log('### select changed');
    var selel = $(dialog_el_id+'_select');
    if (!selel)
        return false;
    var pos = selel.selectedIndex;
    if (!cur_filelist || pos < 0 || pos >= cur_filelist.length)
        return false;
    var file = cur_filelist[pos];
    var fel = $(dialog_el_id+'_infield');
    if (!fel)
        return false;
    fel.value = file.dirent.filename;
    return false;
}

function evhan_accept_load_button() {
    if (!is_open)
        return false;

    GlkOte.log('### accept load');
    var selel = $(dialog_el_id+'_select');
    if (!selel)
        return false;
    var pos = selel.selectedIndex;
    if (!cur_filelist || pos < 0 || pos >= cur_filelist.length)
        return false;
    var file = cur_filelist[pos];
    if (!file_ref_exists(file.dirent))
        return false;

    var callback = dialog_callback;
    GlkOte.log('### selected ' + file.dirent.dirent);
    dialog_close();
    if (callback)
        callback(file.dirent);

    return false;
}

function evhan_accept_save_button() {
    if (!is_open)
        return false;

    GlkOte.log('### accept save');
    var fel = $(dialog_el_id+'_infield');
    if (!fel)
        return false;
    var filename = fel.value;
    filename = filename.strip(); // prototype-ism
    if (!filename)
        return false;
    var dirent = file_construct_ref(filename, cur_usage, cur_gameid);

    if (file_ref_exists(dirent) && !confirming) {
        confirming = true;
        set_caption('You already have a save file "' + dirent.filename 
            + '". Do you want to replace it?', false);
        fel.disabled = true;
        var butel = $(dialog_el_id+'_accept');
        replace_text(butel, 'Replace');
        return false;
    }

    var callback = dialog_callback;
    GlkOte.log('### selected ' + dirent.dirent);
    dialog_close();
    if (callback)
        callback(dirent);

    return false;
}

function evhan_cancel_button() {
    if (!is_open)
        return false;

    if (confirming) {
        confirming = false;
        set_caption(null, false);
        var fel = $(dialog_el_id+'_infield');
        fel.disabled = false;
        var butel = $(dialog_el_id+'_accept');
        butel.disabled = false;
        replace_text(butel, 'Save');
        return false;
    }

    var callback = dialog_callback;
    GlkOte.log('### cancel');
    dialog_close();
    if (callback)
        callback(null);

    return false;
}

function evhan_storage_changed(ev) {
    if (!is_open)
        return false;

    var el, bodyel, ls;

    var changedkey = null;
    if (ev)
        changedkey = ev.key;
    GlkOte.log('### noticed storage: key ' + changedkey);
    /* We could use the changedkey to decide whether it's worth redrawing 
       the field here. */

    bodyel = $(dialog_el_id+'_body');
    if (!bodyel)
        return false;

    ls = files_list(cur_usage, cur_gameid);
    //### sort ls by date
    cur_filelist = ls;
    
    if (ls.length == 0) {
        remove_children(bodyel);
    }
    else {
        remove_children(bodyel);
        
        var selel = new Element('select', { id: dialog_el_id+'_select', name:'files', size:'5' });
        var ix, file, datestr;
        for (ix=0; ix<ls.length; ix++) {
            file = ls[ix];
            el = new Element('option', { name:'f'+ix } );
            if (ix == 0)
                el.selected = true;
            datestr = format_date(file.modified);
            insert_text(el, file.dirent.filename + ' -- ' + datestr);
            selel.insert(el);
        }
        bodyel.insert(selel);

        if (will_save)
            selel.onchange = evhan_select_change;
    }

    //### not "save files"
    if (will_save) {
        set_caption('Name this save file.', true);
        el = $(dialog_el_id+'_accept');
        el.disabled = false;
    }
    else {
        if (ls.length == 0) {
            set_caption('You have no save files for this game.', true);
            el = $(dialog_el_id+'_accept');
            el.disabled = true;
        }
        else {
            set_caption('Select a saved game to load.', true);
            el = $(dialog_el_id+'_accept');
            el.disabled = false;
        }
    }
}

function file_construct_ref(filename, usage, gameid) {
    if (!filename)
        filename = '';
    if (!usage)
        useage = '';
    if (!gameid)
        gameid = '';
    var key = usage + ':' + gameid + ':' + filename;
    var ref = { dirent: 'dirent:'+key, content: 'content:'+key,
                filename: filename, usage: usage, gameid: gameid };
    return ref;
}

function file_decode_ref(dirkey) {
    if (!dirkey.startsWith('dirent:'))
        return null;

    var oldpos = 7;
    var pos = dirkey.indexOf(':', oldpos);
    if (pos < 0)
        return null;
    var usage = dirkey.slice(oldpos, pos);
    oldpos = pos+1;
    
    pos = dirkey.indexOf(':', oldpos);
    if (pos < 0)
        return null;
    var gameid = dirkey.slice(oldpos, pos);
    oldpos = pos+1;

    var filename = dirkey.slice(oldpos);
    var conkey = 'cont'+dirkey.slice(3);

    var ref = { dirent: dirkey, content: conkey, 
                filename: filename, usage: usage, gameid: gameid };
    return ref;
}

function file_load_dirent(dirent) {
    if (typeof(dirent) != 'object') {
        dirent = file_decode_ref(dirent);
        if (!dirent)
            return null;
    }

    var statstring = localStorage.getItem(dirent.dirent);
    if (!statstring)
        return null;

    var file = { dirent: dirent };

    var ix, pos, key, val;

    var ls = statstring.split(',');
    for (ix=0; ix<ls.length; ix++) {
        val = ls[ix];
        pos = val.indexOf(':');
        if (pos < 0)
            continue;
        key = val.slice(0, pos);
        val = val.slice(pos+1);

        switch (key) {
        case 'created':
            file.created = new Date(Number(val));
            break;
        case 'modified':
            file.modified = new Date(Number(val));
            break;
        }
    }

    //### binary
    //### game name?

    return file;
}

function file_ref_exists(ref) {
    var statstring = localStorage.getItem(ref.dirent);
    if (!statstring)
        return false;
    else
        return true;
}

function file_remove_ref(ref) {
    localStorage.removeItem(ref.dirent);
    localStorage.removeItem(ref.content);
}

function file_write(dirent, content, israw) {
    var val, ls;

    var file = file_load_dirent(dirent);
    if (!file) {
        file = { dirent: dirent, created: new Date() };
    }

    file.modified = new Date();

    if (!israw)
        content = encode_array(content);

    ls = [];

    if (file.created)
        ls.push('created:' + file.created.getTime());
    if (file.modified)
        ls.push('modified:' + file.modified.getTime());

    //### binary
    //### game name?

    val = ls.join(',');
    localStorage.setItem(file.dirent.dirent, val);
    localStorage.setItem(file.dirent.content, content);

    return true;
}

function file_read(dirent, israw) {
    var file = file_load_dirent(dirent);
    if (!file)
        return null;

    var content = localStorage.getItem(dirent.content);
    if (content == null)
        return null;

    if (!content) {
        if (israw)
            return '';
        else
            return [];
    }

    if (israw)
        return content;
    else
        return decode_array(content);
}

function file_dirent_matches(dirent, usage, gameid) {
    if (usage != null) {
        if (dirent.usage != usage)
            return false;
    }

    if (gameid != null) {
        if (dirent.gameid != gameid)
            return false;
    }

    return true;
}

function files_list(usage, gameid) {
    var key;
    var ls = [];

    if (!window.localStorage)
        return ls;

    for (key in localStorage) {
        var dirent = file_decode_ref(key);
        if (!dirent)
            continue;
        if (!file_dirent_matches(dirent, usage, gameid))
            continue;
        var file = file_load_dirent(dirent);
        ls.push(file);
    }

    GlkOte.log('### files_list found ' + ls.length + ' files.');
    return ls;
}

function format_date(date) {
    if (!date)
        return '???';
    //### display relative dates?
    var day = (date.getMonth()+1) + '/' + date.getDate();
    var time = date.getHours() + ':' + (date.getMinutes() < 10 ? '0' : '') + date.getMinutes();
    return day + ' ' + time;
}

if (window.JSON) {
    function encode_array(arr) {
        var res = JSON.stringify(arr);
        var len = res.length;
        /* Safari's JSON quotes arrays for some reason; we need to strip
           the quotes off. */
        if (res[0] == '"' && res[len-1] == '"')
            res = res.slice(1, len-1);
        return res;
    }
    function decode_array(val) { return JSON.parse(val); }
}
else {
    /* Not-very-safe substitutes for JSON in old browsers. */
    function encode_array(arr) { return '[' + arr + ']'; }
    function decode_array(val) { return eval(val); }
}

/* Set up storage event handler at load time, but after all the handlers
   are defined. 
*/

window.addEventListener('storage', evhan_storage_changed, false);

return {
    open: dialog_open,

    file_construct_ref: file_construct_ref,
    file_ref_exists: file_ref_exists,
    file_remove_ref: file_remove_ref,
    file_write: file_write,
    file_read: file_read,
};

}();