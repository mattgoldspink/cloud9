/**
 * File Tree for the Cloud9 IDE
 *
 * @copyright 2012, Cloud9 IDE, Inc.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var util = require("core/util");
var fs = require("ext/filesystem/filesystem");
var settings = require("ext/settings/settings");
var panels = require("ext/panels/panels");
var markup = require("text!ext/tree/tree.xml");

function $trScroll() {
    if (this.$scrollTimer)
        clearTimeout(this.$scrollTimer);

    // Set to -1 in case the user scrolls before the tree is done loading,
    // in which case we don't want to set the scroll pos to the saved one
    this.scrollPos = -1;

    this.$scrollTimer = setTimeout(function() {
        var settingsData       = settings.model.data;
        var settingProjectTree = settingsData.selectSingleNode("auto/projecttree");
        if (settingProjectTree)
            apf.xmldb.setAttribute(settingProjectTree, "scrollpos", trFiles.$ext.scrollTop);
    }, 1000);
}

function $cancelWhenOffline() {
    if (!ide.onLine && !ide.offlineFileSystemSupport)
        return false;
}

module.exports = ext.register("ext/tree/tree", {
    name             : "Project Files",
    dev              : "Cloud9 IDE, Inc.",
    alone            : true,
    type             : ext.GENERAL,
    markup           : markup,

    defaultWidth     : 200,

    deps             : [fs],

    expandedNodes    : [],
    loadedSettings   : 0,
    expandedList     : {},
    treeSelection    : { path : null, type : null },
    loading          : false,
    changed          : false,
    animControl      : {},
    nodes            : [],
    model            : null,

    "default"        : true,

    hook : function(){

        // Register this panel on the left-side panels
        panels.register(this, {
            position : 1000,
            caption: "Project Files",
            "class": "project_files"
        });

        var _self = this;

        /**
         * Wait for the filesystem extension to load before we set up our
         * model
         */
        ide.addEventListener("init.ext/filesystem/filesystem", function(e) {
            _self.model = e.ext.model;

            // loadedSettings is set after "loadsettings" is dispatched.
            // Thus if we have our model setup and we have the cached expanded
            // folders, then we can load the project tree
            if (_self.loadedSettings > 0 && _self.inited)
                _self.onReady();
        });

        ide.addEventListener("loadsettings", function(e){
            var model = e.model;
            (davProject.realWebdav || davProject).setAttribute("showhidden",
                apf.isTrue(model.queryValue('auto/projecttree/@showhidden')));

            _self.scrollPos = model.queryValue('auto/projecttree/@scrollpos');

            // auto/projecttree contains the saved expanded nodes
            var strSettings = model.queryValue("auto/projecttree");
            if (strSettings) {
                try {
                    _self.expandedNodes = JSON.parse(strSettings);
                }
                catch (ex) {
                    _self.expandedNodes = [ide.davPrefix];
                }

                // Get the last selected tree node
                var savedTreeSelection = model.queryNode("auto/tree_selection");
                if (savedTreeSelection) {
                    _self.treeSelection.path = model.queryValue('auto/tree_selection/@path');
                    _self.treeSelection.type = model.queryValue('auto/tree_selection/@type');
                }

                _self.loadedSettings = 1;

                // Please see note above about waiting for both the model and
                // the settings to be loaded before loading the project tree
                if (_self.model && _self.inited)
                    _self.onReady();
            }
            else {
                _self.loadedSettings = 2;
                if (_self.model && _self.inited)
                    _self.onReady();
            }
        });

        ide.addEventListener("savesettings", function(e){
            if (!_self.changed)
                return;

            var expandedNodes = apf.createNodeFromXpath(e.model.data, "auto/projecttree/text()");
            _self.expandedNodes = [];

            var path, id;

            // expandedList keeps an active record of all the expanded nodes
            // so that on each save this gets serialized into the auto/projecttree
            // settings node
            for (id in _self.expandedList) {
                path = _self.expandedList[id].getAttribute("path");
                if (!path) {
                    delete _self.expandedList[id];
                }
                else {
                    _self.expandedNodes.push(path);
                }
            }

            expandedNodes.nodeValue = JSON.stringify(_self.expandedNodes);
            _self.changed = false;
            return true;
        });

        /**
         * This receives updates from the tree watcher on the backend
         * I haven't looked deeply at this code, but it looks like it removes
         * and adds nodes
         */
        ide.addEventListener("treechange", function(e) {
            var path = e.path.replace(/\/([^/]*)/g, "/node()[@name=\"$1\"]")
                                .replace(/\[@name="workspace"\]/, "")
                                .replace(/\//, "");
            var parent = trFiles.getModel().data.selectSingleNode(path);

            if (!parent)
                return;

            var nodes   = parent.childNodes;
            var files   = e.files;
            var removed = [];

            for (var i = 0; i < nodes.length; ++i) {
                var node = nodes[i],
                    name = node.getAttribute("name");

                if (files && files[name])
                    delete files[name];
                else
                    removed.push(node);
            }
            removed.forEach(function (node) {
                apf.xmldb.removeNode(node);
            });
            path = parent.getAttribute("path");
            for (var filename in files) {
                var file = files[filename];

                var xmlNode = "<" + file.type +
                    " type='" + file.type + "'" +
                    " name='" + filename + "'" +
                    " path='" + path + "/" + filename + "'" +
                "/>";
                trFiles.add(xmlNode, parent);
            }
        });
        
        ext.initExtension(this);
    },

    onReady : function() {
        var _self = this;
        trFiles.setAttribute("model", this.model);
        if(this.loadedSettings === 1) {
            setTimeout(function() {
                _self.loadProjectTree();
            }, 1000);
        }

        // If no settings were found, then we set the "get" attribute of
        // the AML insert rule for the tree and expand the root. The
        // "get" attr is originally empty by default so when we run
        // this.loadProjectTree() the tree itself doesn't try to duplicate
        // our actions
        else {
            trFilesInsertRule.setAttribute("get", "{davProject.readdir([@path])}");
            trFiles.expandAll();
        }
    },

    init : function() {
        var _self = this;

        // Set the panel var for the panels extension
        this.panel = winFilesViewer;
        this.nodes.push(winFilesViewer);

        colLeft.appendChild(winFilesViewer);

        // This adds a "Show Hidden Files" item to the settings dropdown
        // from the Project Files header
        mnuFilesSettings.appendChild(new apf.item({
            id      : "mnuitemHiddenFiles",
            type    : "check",
            caption : "Show Hidden Files",
            visible : "{trFiles.visible}",
            checked : "[{require('ext/settings/settings').model}::auto/projecttree/@showhidden]",
            onclick : function(e){
                setTimeout(function() {
                    _self.changed = true;
                    (davProject.realWebdav || davProject)
                        .setAttribute("showhidden", e.currentTarget.checked);

                    _self.refresh();
                });
            }
        }));

        this.setupTreeListeners();

        if (_self.loadedSettings > 0 && _self.model)
            _self.onReady();
    },

    /**
     * Sets up listeners on tree events
     */
    setupTreeListeners : function() {
        var _self = this;

        // After an item in the tree has been clicked on, this saves that
        // selection in the settings model
        trFiles.addEventListener("afterselect", this.$afterselect = function(e) {
            if (settings.model && settings.model.data && trFiles.selected) {
                var nodePath          = trFiles.selected.getAttribute("path").replace(/"/g, "&quot;");
                var nodeType          = trFiles.selected.getAttribute("type");
                var settingsData      = settings.model.data;
                var treeSelectionNode = settingsData.selectSingleNode("auto/tree_selection");
                if(treeSelectionNode) {
                    apf.xmldb.setAttribute(treeSelectionNode, "path", nodePath);
                    apf.xmldb.setAttribute(treeSelectionNode, "type", nodeType);
                }
                else {
                    apf.xmldb.appendChild(settingsData.selectSingleNode("auto"),
                        apf.getXml('<tree_selection path="' + nodePath +
                            '" type="' + nodeType + '" />')
                    );
                }

                // Also update our own internal selection vars for when the
                // user refreshes the tree
                _self.treeSelection.path = nodePath;
                _self.treeSelection.type = nodeType;
            }
        });

        // Opens a file after the user has double-clicked
        trFiles.addEventListener("afterchoose", this.$afterchoose = function() {
            var node = this.selected;
            if (!node || node.tagName != "file" || this.selection.length > 1 ||
                !ide.onLine && !ide.offlineFileSystemSupport) //ide.onLine can be removed after update apf
                    return;

            ide.dispatchEvent("openfile", {doc: ide.createDocument(node)});
        });

        trFiles.addEventListener("beforecopy", this.$beforecopy = function(e) {
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            var args     = e.args[0].args,
                filename = args[1].getAttribute("name");

            var count = 0;
            filename.match(/\.(\d+)$/, "") && (count = parseInt(RegExp.$1, 10));
            while (args[0].selectSingleNode('node()[@name="' + filename.replace(/"/g, "&quot;") + '"]')) {
                filename = filename.replace(/\.(\d+)$/, "") + "." + ++count;
            }
            args[1].setAttribute("newname", filename);

            setTimeout(function () {
                fs.beforeRename(args[1], null,
                    args[0].getAttribute("path").replace(/[\/]+$/, "") +
                    "/" + filename, true);
                args[1].removeAttribute("newname");
            });
        });

        trFiles.addEventListener("beforestoprename", this.$beforestoprename = function(e) {
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            return fs.beforeStopRename(e.value);
        });

        trFiles.addEventListener("beforerename", this.$beforerename = function(e){
            if (!ide.onLine && !ide.offlineFileSystemSupport) return false;

            if(trFiles.$model.data.firstChild == trFiles.selected)
                return false;

            // check for a path with the same name, which is not allowed to rename to:
            var path = e.args[0].getAttribute("path"),
                newpath = path.replace(/^(.*\/)[^\/]+$/, "$1" + e.args[1]).toLowerCase();

            var exists, nodes = trFiles.getModel().queryNodes(".//node()");
            for (var i = 0, len = nodes.length; i < len; i++) {
                var pathLwr = nodes[i].getAttribute("path").toLowerCase();
                if (nodes[i] != e.args[0] && pathLwr === newpath) {
                    exists = true;
                    break;
                }
            }

            if (exists) {
                util.alert("Error", "Unable to Rename",
                    "That name is already taken. Please choose a different name.");
                trFiles.getActionTracker().undo();
                return false;
            }

            fs.beforeRename(e.args[0], e.args[1]);
        });

        trFiles.addEventListener("beforemove", this.$beforemove = function(e){
            if (!ide.onLine && !ide.offlineFileSystemSupport)
                return false;

            setTimeout(function(){
                var changes = e.args;
                for (var i = 0; i < changes.length; i++) {
                    // If any file exists in its future destination, cancel the event.
                    fs.beforeMove(changes[i].args[0], changes[i].args[1], trFiles);
                }
            });
        });

        trFiles.addEventListener("keyup", this.$keyup = function(e){
            if(this.dragging > 0 && e.keyCode == 27) {
                apf.DragServer.stop();
            }
        });
        
        trFiles.addEventListener("scroll", $trScroll);

        trFiles.addEventListener("beforeadd", $cancelWhenOffline);
        trFiles.addEventListener("renamestart", $cancelWhenOffline);
        trFiles.addEventListener("beforeremove", $cancelWhenOffline);
        trFiles.addEventListener("dragstart", $cancelWhenOffline);
        trFiles.addEventListener("dragdrop", $cancelWhenOffline);

        // When a folder has been expanded, save it in expandedList
        trFiles.addEventListener("expand", this.$expand = function(e){
            if (!e.xmlNode)
                return;
            _self.expandedList[e.xmlNode.getAttribute(apf.xmldb.xmlIdTag)] = e.xmlNode;

            // Only save if we are not loading the tree
            if (!_self.loading) {
                _self.changed = true;
                settings.save();
            }
        });

        // When a folder has been expanded, remove it from expandedList
        trFiles.addEventListener("collapse", this.$collapse = function(e){
            if (!e.xmlNode)
                return;
            delete _self.expandedList[e.xmlNode.getAttribute(apf.xmldb.xmlIdTag)];

            if (!_self.loading) {
                _self.changed = true;
                settings.save();
            }
        });
    },

    $cancelWhenOffline : function() {
        if (!ide.onLine && !ide.offlineFileSystemSupport)
            return false;
    },

    moveFile : function(path, newpath){
        davProject.move(path, newpath);
        trFiles.enable();
        trFiles.focus();
    },

    /**
     * Loads the project tree based on expandedNodes, which is an array of
     * folders that were previously expanded, otherwise it contains only the
     * root identifier (i.e. ide.davPrefix)
     * 
     * @param callback function Called when the tree is fully loaded
     */
    loadProjectTree : function(callback) {
        var _self = this;

        if (!this.expandedNodes.length)
            this.expandedNodes = [ide.davPrefix];
        else
            this.expandedNodes.sort();

        this.loading = true;

        var numFoldersLoaded = 0;

        // Stores child nodes of parents who do not exist in the tree yet
        var orphanedChildren = [];

        // Get the parent node of the new items. If the path is the
        // same as `ide.davPrefix`, then we append to root
        function getParentNodeFromPath(path) {
            var parentNode;
            if (path === ide.davPrefix)
                parentNode = trFiles.queryNode("folder[@root=1]");
            else
                parentNode = trFiles.queryNode('//folder[@path="' + path + '"]');

            return parentNode;
        }

        function appendXmlToNode(parentNode, dataXml) {
            trFiles.insert(dataXml, { insertPoint: parentNode });

            // Set the load status to "loaded" so APF doesn't assume the child
            // nodes still need to be loaded
            trFiles.$setLoadStatus(parentNode, "loaded");

            // Slide open the folder
            trFiles.slideToggle(apf.xmldb.getHtmlNode(parentNode, trFiles), 1, true, null, null);
        }

        /* Go through the orphaned children and attempt to append them to
         * the tree
         *
         * Called after XML has been added
         */
        function tryAppendingOrphansToTree() {
            // If all the folder children have been loaded and there are no
            // more orphans to append, then finish
            if (numFoldersLoaded === _self.expandedNodes.length && !orphanedChildren.length)
                return onFinish();

            for (var ic = 0; ic < orphanedChildren.length; ic++) {
                cleanParentPath = orphanedChildren[ic].cleanParentPath;
                parentNode = getParentNodeFromPath(cleanParentPath);
                if (parentNode) {
                    appendXmlToNode(parentNode, orphanedChildren[ic].dataXml);
                    orphanedChildren.splice(ic, 1);

                    // We just appended new nodes, so run this again. But, wait
                    // a tick so the new nodes have time to expand
                    setTimeout(function() {
                        tryAppendingOrphansToTree();
                    });
                    return;
                }
            }
        }

        function loadFolder(path) {
            // At some point davProject.realWebdav is set but you'll note that
            // tree.xml is able ot use just davProject (which is an intended
            // global). Why we cannot use that here escapes me, so we have to
            // check which one is available for us to use (and yes, realWebdav
            // can sometimes not be set on initial load)
            (davProject.realWebdav || davProject).readdir(path, function(data, state, extra) {
                numFoldersLoaded++;

                if (extra.status === 404) {
                    _self.changed = true;
                    return;
                }

                var dataXml = apf.getXml(data);

                // Strip the extra "/" that webDav adds on
                var cleanParentPath = extra.url.substr(0, extra.url.length-1);
                var parentNode = getParentNodeFromPath(cleanParentPath);

                // If we can't find the parent node in the tree, then store
                // the the result to add later
                if (!parentNode) {
                    orphanedChildren.push({
                        cleanParentPath : cleanParentPath,
                        dataXml : dataXml
                    });
                }
                else {
                    appendXmlToNode(parentNode, dataXml);
                    tryAppendingOrphansToTree();
                }

                // If all the folder children have been loaded and there are no
                // more orphans to append, then finish
                if (numFoldersLoaded === _self.expandedNodes.length && !orphanedChildren.length)
                    return onFinish();
            });
        }

        // Iterate through this.expandedNodes to load up the saved list of
        // project tree folders
        for (var i = 0; i < this.expandedNodes.length; i++)
            loadFolder(this.expandedNodes[i]);

        // Called when every cached node has been loaded
        function onFinish() {
            // There is the possibility that we are calling this twice
            if (!_self.loading)
                return;

            _self.loading = false;

            // Re-select the last selected item
            if(_self.treeSelection.path) {
                var xmlNode = trFiles.$model.queryNode('//node()[@path="' +
                    _self.treeSelection.path + '" and @type="' +
                    _self.treeSelection.type + '"]');
                trFiles.select(xmlNode);
            }
            else {
                trFiles.select(trFiles.$model.queryNode("node()"));
            }

            // Scroll to last set scroll pos
            if (_self.scrollPos && _self.scrollPos > -1)
                trFiles.$ext.scrollTop = _self.scrollPos;

            // Now set the "get" attribute of the <a:insert> rule so the tree
            // knows to ask webdav for expanded folders' contents automatically
            trFilesInsertRule.setAttribute("get", "{davProject.readdir([@path])}");

            settings.save();

            if (callback)
                return callback();
        }
    },

    /**
     * Called when the user hits the refresh button in the Project Files header
     */
    refresh : function(){
        // When we clear the model below, it dispatches a scroll event which
        // we don't want to process, so remove that event listener
        trFiles.removeEventListener("scroll", $trScroll);

        this.scrollPos = trFiles.$ext.scrollTop;

        trFiles.getModel().load("<data><folder type='folder' name='" +
            ide.projectName + "' path='" + ide.davPrefix + "' root='1'/></data>");
        this.expandedList = {};

        // Make sure the "get" attribute is empty so the file tree doesn't
        // think it's the one loading up all the data when loadProjectTree
        // expands folders
        trFilesInsertRule.setAttribute("get", "");

        ide.dispatchEvent("track_action", { type: "reloadtree" });

        this.loadProjectTree();

        // Now re-attach the scroll listener
        trFiles.addEventListener("scroll", $trScroll);
    },

    enable : function(){
        this.nodes.each(function(item){
            item.enable();
        });
    },

    disable : function(){
        this.nodes.each(function(item){
            item.disable();
        });
    },

    destroy : function(){
        trFiles.removeEventListener("afterselect", this.$afterselect);
        trFiles.removeEventListener("afterchoose", this.$afterchoose);
        trFiles.removeEventListener("expand", this.$expand);
        trFiles.removeEventListener("collapse", this.$collapse);
        trFiles.removeEventListener("beforemove", this.$beforemove);
        trFiles.removeEventListener("beforerename", this.$beforerename);
        trFiles.removeEventListener("beforestoprenam", this.$beforestoprename);
        trFiles.removeEventListener("beforecopy", this.$beforecopy);
        trFiles.removeEventListener("beforeadd", $cancelWhenOffline);
        trFiles.removeEventListener("renamestart", $cancelWhenOffline);
        trFiles.removeEventListener("beforeremove", $cancelWhenOffline);
        trFiles.removeEventListener("dragstart", $cancelWhenOffline);
        trFiles.removeEventListener("dragdrop", $cancelWhenOffline);
        trFiles.removeEventListener("keyup", this.$keyup);
        trFiles.removeEventListener("scroll", $trScroll);

        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];

        panels.unregister(this);
    }
});

});
