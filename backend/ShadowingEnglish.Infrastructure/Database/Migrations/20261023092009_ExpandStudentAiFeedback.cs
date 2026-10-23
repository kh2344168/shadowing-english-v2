using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ShadowingEnglish.Infrastructure.Database.Migrations
{
    /// <inheritdoc />
    public partial class ExpandStudentAiFeedback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "FeedbackJson",
                table: "StudentPracticeAttempts",
                type: "nvarchar(max)",
                maxLength: 32000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(3000)",
                oldMaxLength: 3000);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "FeedbackJson",
                table: "StudentPracticeAttempts",
                type: "nvarchar(3000)",
                maxLength: 3000,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(max)",
                oldMaxLength: 32000);
        }
    }
}
