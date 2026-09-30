import "./CustomerActivity.css";

type ActivityRecord = {
  icon: string;
  iconClass: string;
  actionType: string;
  details: string;
  dateTime: string;
  affectedItem: string;
  location: string;
};

const chartData = [
  { day: "Mon", value: 8 },
  { day: "Tue", value: 12 },
  { day: "Wed", value: 9 },
  { day: "Thu", value: 9 },
  { day: "Fri", value: 15 },
  { day: "Sat", value: 6 },
  { day: "Sun", value: 10 },
];

const activities: ActivityRecord[] = [
  {
    icon: "⚙",
    iconClass: "gear",
    actionType: "Gear",
    details: "Subscription upgrade by Sneha Nikam",
    dateTime: "Jul 12, 2025, 14:32:01",
    affectedItem: "Enterprise Plan",
    location: "Mumbai, IN",
  },
  {
    icon: "✎",
    iconClass: "pencil",
    actionType: "Pencil",
    details: "Subscription upgrade by Sneha Nikam",
    dateTime: "Jul 12, 2025, 14:32:01",
    affectedItem: "Enterprise Plan",
    location: "Mumbai, IN",
  },
  {
    icon: "$",
    iconClass: "saved",
    actionType: "Saved",
    details: "Subscription upgrade by Sneha Nikam",
    dateTime: "Jul 12, 2025, 14:32:01",
    affectedItem: "Enterprise Plan",
    location: "Mumbai, IN",
  },
  {
    icon: "⚙",
    iconClass: "gear",
    actionType: "Gear",
    details: "Customer profile updated by Rahul Kadam",
    dateTime: "Jul 11, 2025, 16:18:24",
    affectedItem: "Customer Profile",
    location: "Pune, IN",
  },
  {
    icon: "✎",
    iconClass: "pencil",
    actionType: "Pencil",
    details: "Account information edited by Yash",
    dateTime: "Jul 11, 2025, 15:05:12",
    affectedItem: "Customer Profile",
    location: "Mumbai, IN",
  },
];

const heatmap = Array.from({ length: 35 }, (_, index) => {
  const values = [1, 2, 0, 3, 1, 4, 2, 5, 0, 3];
  return values[index % values.length];
});

const ActivityPage = () => {
  return (
    <div className="activity-page">

      {/* HEADER */}
      <div className="activity-page-header">
        <div>
          <h1>Customer Activity</h1>
          <p>Track customer actions and account activity</p>
        </div>
      </div>

      {/* TOP SECTION */}
      <div className="activity-top-grid">

        {/* ACTIVITY OVERVIEW */}
        <div className="activity-overview-card">

          <div className="activity-card-title">
            <div>
              <h2>Activity Overview</h2>
              <p>Customer activity during the selected period</p>
            </div>

            <select className="activity-period">
              <option>Last 7 Days</option>
              <option>Last 30 Days</option>
              <option>Last 90 Days</option>
            </select>
          </div>

          {/* GRAPH */}
          <div className="line-chart">

            <div className="chart-y-axis">
              <span>20</span>
              <span>15</span>
              <span>10</span>
              <span>5</span>
              <span>0</span>
            </div>

            <div className="chart-area">

              <div className="chart-grid-lines">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>

              <svg
                className="activity-svg"
                viewBox="0 0 700 230"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="activityFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="#5368e9"
                      stopOpacity="0.30"
                    />
                    <stop
                      offset="100%"
                      stopColor="#5368e9"
                      stopOpacity="0.03"
                    />
                  </linearGradient>
                </defs>

                <path
                  d="M0 145
                     C45 125, 55 110, 100 100
                     C145 90, 155 105, 200 112
                     C245 119, 255 130, 300 112
                     C345 94, 360 65, 400 48
                     C440 31, 455 52, 500 70
                     C545 88, 560 125, 600 150
                     C640 175, 660 145, 700 112
                     L700 230
                     L0 230 Z"
                  fill="url(#activityFill)"
                />

                <path
                  d="M0 145
                     C45 125, 55 110, 100 100
                     C145 90, 155 105, 200 112
                     C245 119, 255 130, 300 112
                     C345 94, 360 65, 400 48
                     C440 31, 455 52, 500 70
                     C545 88, 560 125, 600 150
                     C640 175, 660 145, 700 112"
                  fill="none"
                  stroke="#5368e9"
                  strokeWidth="4"
                />

                {[
                  [0, 145, 8],
                  [100, 100, 12],
                  [200, 112, 9],
                  [300, 112, 9],
                  [400, 48, 15],
                  [500, 70, 11],
                  [600, 150, 6],
                  [700, 112, 10],
                ].map(([x, y, value], index) => (
                  <g key={index}>
                    <circle
                      cx={x}
                      cy={y}
                      r="6"
                      fill="#ffffff"
                      stroke="#5368e9"
                      strokeWidth="4"
                    />
                    <text
                      x={x}
                      y={y - 13}
                      textAnchor="middle"
                      fontSize="12"
                      fontWeight="600"
                      fill="#536078"
                    >
                      {value}
                    </text>
                  </g>
                ))}
              </svg>

              <div className="chart-labels">
                {chartData.map((item) => (
                  <span key={item.day}>{item.day}</span>
                ))}
              </div>

            </div>
          </div>

          {/* STATS + HEATMAP */}
          <div className="activity-bottom">

            <div className="activity-stat">
              <small>Total Activities:</small>
              <strong>8,370</strong>
            </div>

            <div className="activity-stat">
              <small>Peak Activity Day:</small>
              <strong>Thu</strong>
            </div>

            <div className="activity-stat">
              <small>Average Activity:</small>
              <strong>223.66</strong>
            </div>

            <div className="heatmap-box">
              <strong>Activity Heatmap</strong>

              <div className="heatmap">
                {heatmap.map((value, index) => (
                  <span
                    key={index}
                    className={`heat-${value}`}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="activity-side">

          {/* DONUT */}
          <div className="side-card">
            <h2>Activity Type Breakdown</h2>

            <div className="donut-section">
              <div className="donut-chart">
                <div className="donut-center">
                  <strong>8.3K</strong>
                  <span>Activities</span>
                </div>
              </div>

              <div className="donut-legend">
                <div>
                  <i className="legend-page" />
                  <span>Page Views</span>
                </div>

                <div>
                  <i className="legend-api" />
                  <span>API Calls</span>
                </div>

                <div>
                  <i className="legend-plan" />
                  <span>Plan Upgrades</span>
                </div>

                <div>
                  <i className="legend-support" />
                  <span>Customer Support</span>
                </div>
              </div>
            </div>
          </div>

          {/* TOP CUSTOMERS */}
          <div className="side-card top-customers-card">
            <h2>Top Customers by Activity</h2>

            <div className="top-customer">
              <div className="top-avatar">SN</div>
              <strong>Sneha Nikam</strong>
              <span>8,420</span>
            </div>

            <div className="top-customer">
              <div className="top-avatar purple">RK</div>
              <strong>Rahul Kadam</strong>
              <span>6,980</span>
            </div>

            <div className="top-customer">
              <div className="top-avatar green">YA</div>
              <strong>Yash</strong>
              <span>5,640</span>
            </div>
          </div>

        </div>
      </div>

      {/* RECENT ACTIVITY */}
      <div className="recent-activity-card">

        <div className="recent-header">
          <div>
            <h2>Recent Activity</h2>
            <p>Latest customer actions</p>
          </div>

          <button className="recent-add-btn">
            + Add customer
          </button>
        </div>

        {/* FILTERS */}
        <div className="recent-filters">

          <select>
            <option>Date Range</option>
            <option>Today</option>
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
          </select>

          <select>
            <option>Activity Type</option>
            <option>Page Views</option>
            <option>API Calls</option>
            <option>Plan Upgrade</option>
          </select>

          <select>
            <option>Status</option>
            <option>Success</option>
            <option>Pending</option>
            <option>Failed</option>
          </select>

          <select>
            <option>User</option>
            <option>Sneha Nikam</option>
            <option>Rahul Kadam</option>
            <option>Yash</option>
          </select>

          <select>
            <option>Search</option>
          </select>

          <div className="recent-search">
            🔍
            <input placeholder="Search..." />
          </div>

        </div>

        {/* TABLE */}
        <div className="activity-table-wrapper">

          <table className="activity-table">

            <thead>
              <tr>
                <th>Action Type</th>
                <th>Activity Details</th>
                <th>Date/Time</th>
                <th>Affected Item</th>
                <th>Location</th>
              </tr>
            </thead>

            <tbody>
              {activities.map((activity, index) => (
                <tr key={index}>

                  <td>
                    <div className="action-type">
                      <span className={`action-icon ${activity.iconClass}`}>
                        {activity.icon}
                      </span>
                      <strong>{activity.actionType}</strong>
                    </div>
                  </td>

                  <td>{activity.details}</td>

                  <td>{activity.dateTime}</td>

                  <td>
                    <span className={`affected-tag tag-${index % 3}`}>
                      {activity.affectedItem}
                    </span>
                  </td>

                  <td>{activity.location}</td>

                </tr>
              ))}
            </tbody>

          </table>

        </div>
      </div>

    </div>
  );
};

export default ActivityPage;