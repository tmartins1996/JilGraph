"use strict";

// parent: top-level DOM object for the graph
function GraphBuilder(jilArray, topContainer) {
    this.topContainer = topContainer;
    this.jilArray = jilArray;
    this.idPrefix = "jildiv_";
    this.jilParser = new JilParser();

    this.connectionWidth = 3;
    
    this.connectorColor = '#A8D0F5';
    this.connectorHoverColor = '#8EC1F0';
    this.inboundConnectorColor = '#3BA617';
    this.inboundConnectorHoverColor = '#23670C';
    this.outboundConnectorColor = '#FF0000';
    this.outboundConnectorHoverColor = '#BF1313';
    
    // Don't use this property directly, use getConnections() instead (it's lazy-loading the property). 
    this.connections = null;
    this.selectedJob = null;
    this.selectedDependencyLevel = 0;
    
    this.initialiseJsPlumb();
}

GraphBuilder.prototype.draw = function() {
    this.insertDivs();
    this.insertConnections();
};

GraphBuilder.prototype.insertDivs = function() {
    var thisBulider = this;
    $.each(this.getTopLevelJobs(), function(i, job) {
        thisBulider.addJobWithChildren(job, thisBulider.topContainer);
    });
};

GraphBuilder.prototype.insertConnections = function() {
    var thisBuilder = this;
    $.each(this.getConnections(), function(i, connection) {
        var conn = jsPlumb.connect({
            source: $("#" + thisBuilder.addIdPrefix(connection.source)),
            target: $("#" + thisBuilder.addIdPrefix(connection.target)),
            anchor: "Continuous",
            endpoint: ["Dot", { radius: 3 }],
            type: "basic"
        });
        conn.bind("click", function() {
            conn.toggleType("selected");
            //conn.setPaintStyle({lineWidth:2, strokeStyle: thisBuilder.swapConnectorColor(conn.getPaintStyle().strokeStyle)});
            //conn.getOverlays()[0].setPaintStyle({ lineWidth: 1, strokeStyle: "green" });
        });
    });    
};

GraphBuilder.prototype.initialiseJsPlumb = function() {
    var thisBuilder = this;
    jsPlumb.ready(function() {
        jsPlumb.importDefaults({
            Container: $("body")
        });
        jsPlumb.registerConnectionTypes({
            basic: {
                paintStyle: {lineWidth: thisBuilder.connectionWidth, strokeStyle: thisBuilder.connectorColor},
                hoverPaintStyle: { strokeStyle: thisBuilder.connectorHoverColor },
                connector: ["Bezier", { curviness: 40 }],
                //connector: "Flowchart",
                detachable: false,
                overlays:[[
                    "Arrow", 
                    {   location: 1, width: 10
                    }
                ]]
            },
            selected: {
                paintStyle: { lineWidth: thisBuilder.connectionWidth, dashstyle: "2 1" },
            },
            inbound: {
                paintStyle: {lineWidth: thisBuilder.connectionWidth, strokeStyle: thisBuilder.inboundConnectorColor},
                hoverPaintStyle: { strokeStyle: thisBuilder.inboundConnectorHoverColor },
                overlays:[[
                    "Arrow", 
                    {   location: 1, width: 10, 
                    }
                ]]
            },
            outbound: {
                paintStyle: {lineWidth: thisBuilder.connectionWidth, strokeStyle: thisBuilder.outboundConnectorColor},
                hoverPaintStyle: { strokeStyle: thisBuilder.outboundConnectorHoverColor },
                overlays:[[
                    "Arrow", 
                    {   location: 1, width: 10, 
                    }
                ]]
            }
        });
        $(window).resize(function(){
            jsPlumb.repaintEverything();
        });
    });
};

// Recursively adds a div for the job/box object.
// Then, if the job is a box, adds divs for its children.
GraphBuilder.prototype.addJobWithChildren = function(job, parentDiv) {
    try {
        var div = this.addJobDiv(job, parentDiv);
        var thisBulider = this;
        $.each(this.getBoxChildren(job), function(i, child) {
            thisBulider.addJobWithChildren(child, div);
        });
    } catch (e) {
        throw new Error("Error when adding job '" + job.name + "' to div '" + parentDiv.id + "': " + e.message);
    }
};

// Creates div for the job or box and adds it to the parent container.
GraphBuilder.prototype.addJobDiv = function(job, parentDiv) {
    var thisGraph = this; 
    var div = $('<div>', 
    {   id: this.idPrefix + job.name, 
        class: "generic-job " + this.getJobClass(job)
    })
        .text(job.name)
        .appendTo(parentDiv)
        .click(function (event) {
        	if (job == thisGraph.selectedJob) {
                thisGraph.setSelectedDependencyLevel(thisGraph.selectedDependencyLevel + (event.shiftKey ? -1 : 1));
            } else {
                thisGraph.setSelectedJob(job);
            };
            event.stopPropagation();
        })
        [0];
    return div;
};

GraphBuilder.prototype.addIdPrefix = function(str) {
    return this.idPrefix + str;
};

GraphBuilder.prototype.removeIdPrefix = function(str) {
    var l = this.idPrefix.length;
	if (str.substring(0, l) != this.idPrefix) {
		throw new Error("Expected prefix not found (prefix: '" + this.idPrefix + "', string: '" + str + "')");
    	
    }
	return str.substring(l);
};

GraphBuilder.prototype.getJobClass = function(job, parent) {
    var jobType = job.job_type;
    switch (jobType) {
    case "c" : return "job";
    case "b" : return "box";
    }
    throw new Error("Unknown job type: " + jobType);
};

GraphBuilder.prototype.getTopLevelJobs = function() {
    return $.grep(this.jilArray, function(job) {
        return !job.hasOwnProperty("box_name");
    });
};

// Returns an empty array if the provided object is not a box
// or the box has no children.
GraphBuilder.prototype.getBoxChildren = function(box) {
    return $.grep(this.jilArray, function(job){
        return job.box_name == box.name;
    });
};

// Returns an array of JilConnection structures representing all jil dependencies.
GraphBuilder.prototype.getConnections = function() {
    if (this.connections == null) {
        this.connections = [];
        var thisGraph = this;
        $.each(this.jilArray, function(i, job) {
            thisGraph.connections = thisGraph.connections.concat(job.condition);
        });
    }
    return this.connections;
};

GraphBuilder.prototype.getInboundConnections = function(job, level) {
    return this.getBoundConnections(job, level, true);
};

GraphBuilder.prototype.getOutboundConnections = function(job, level) {
    return this.getBoundConnections(job, level, false);
};

// Returns an array of JilConnection objects.
// level:   Specifies how many levels of connections to return. Level 1 means direct connections.
//          Level 2 means direct connections and their direct connections, and so on.
// inbound: If inbound=true, inbound connections are returned (where target=job.name).
//          Otherwise, outbound connections are returned (where source=job.name).
GraphBuilder.prototype.getBoundConnections = function(job, level, inbound) {
    var found = $.grep(this.getConnections(), function(connection) {
        return (inbound ? connection.target : connection.source) == job.name;
    });
    if (level > 1) {
        var foundDescendants = [];
        var thisBuilder = this;
        $.each(found, function(i, directConnection) {
            var newFound = thisBuilder.getBoundConnections(
                thisBuilder.jilParser.findJob(thisBuilder.jilArray, inbound ? directConnection.source : directConnection.target),
                level - 1,
                inbound);
            // Add only those from newFound which do not already exist in foundDescendants
            foundDescendants = foundDescendants.concat(
                $.grep(newFound, function(newFoundConn) {
                    for (var j = 0; j < foundDescendants.length; j++) {
                        if (newFoundConn.equals(foundDescendants[j])) {
                            return false;
                        }
                    };
                    return true;
                })
            );
        });
        found = found.concat(foundDescendants);
    }
    return found;
};

// Clears all selected dependencies and selects direct dependencies of the provided job, 
// even if the provided job is already selected. 
GraphBuilder.prototype.setSelectedJob = function(job) {
	this.setSelectedDependencyLevel(0);
	
	if (this.selectedJob) {
		$("#" + this.addIdPrefix(this.selectedJob.name)).removeClass("selected-job");;
	}
	
	this.selectedJob = job;
	this.setSelectedDependencyLevel(1);
	$("#" + this.addIdPrefix(this.selectedJob.name)).addClass("selected-job");;
};

GraphBuilder.prototype.setSelectedDependencyLevel = function(level) {
    var thisGraph = this;
    if (level <= 0) {
        this.selectedDependencyLevel = 0;
        $.each(jsPlumb.getConnections(), function(i, plumbConn) {
            if (plumbConn.hasType("inbound")) { plumbConn.removeType("inbound"); };
            if (plumbConn.hasType("outbound")) { plumbConn.removeType("outbound"); }
        });
    } else {
        var inboundConnections = this.getInboundConnections(this.selectedJob, level);
        var outboundConnections = this.getOutboundConnections(this.selectedJob, level);

    	var anyUpdated = false;
        var updateHighlightedConnections = function(connectionsToHighlight, connectionType) {
            // returns true if any connections were updated; false otherwise
            $.each(jsPlumb.getConnections(), function(i, plumbConn) {
                var toHighlight = false;
                for (var i = 0; i < connectionsToHighlight.length; i++) {
                    if (thisGraph.addIdPrefix(connectionsToHighlight[i].source) == plumbConn.source.id 
                    		&& thisGraph.addIdPrefix(connectionsToHighlight[i].target) == plumbConn.target.id) 
                    {
                    	toHighlight = true;
                        break;
                    }
                }
                if (toHighlight && !plumbConn.hasType(connectionType)) {
                    plumbConn.addType(connectionType);
                    if (!anyUpdated) { anyUpdated = true; };
                } else if (!toHighlight && plumbConn.hasType(connectionType)) {
                	plumbConn.removeType(connectionType);
                    if (!anyUpdated) { anyUpdated = true; };
                }
            });
        };
        updateHighlightedConnections(inboundConnections, "inbound");
        updateHighlightedConnections(outboundConnections, "outbound");
        if (anyUpdated) {
        	// Updating the dependency level only if any changes were detected.
        	// No changes can mean that the maximum dependency level has been reached.
            this.selectedDependencyLevel = level;
        }
    }    
};
